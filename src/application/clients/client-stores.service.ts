import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StoreStatus } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';

const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE'] as const;

@Injectable()
export class ClientStoresService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, businessName: true, status: true },
    });
    if (!client) throw new NotFoundException('Client was not found.');
    const [subscription, stores] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: {
          clientId,
          deletedAt: null,
          status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, maxStores: true, status: true },
      }),
      this.prisma.store.findMany({
        where: { clientId },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          clientId: true,
          code: true,
          name: true,
          status: true,
          timezone: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { devices: { where: { status: 'ACTIVE' } } } },
          activeSnapshot: {
            select: { snapshotCreatedAt: true, activatedAt: true },
          },
        },
      }),
    ]);
    const used = stores.filter((store) => store.status !== 'ARCHIVED').length;
    const maxStores = subscription?.maxStores ?? 1;
    return {
      client,
      quota: {
        used,
        maxStores,
        available: Math.max(0, maxStores - used),
        subscriptionStatus: subscription?.status ?? null,
      },
      stores: stores.map(({ _count, activeSnapshot, ...store }) => ({
        ...store,
        registeredDeviceCount: _count.devices,
        lastSnapshotAt:
          activeSnapshot?.snapshotCreatedAt ??
          activeSnapshot?.activatedAt ??
          null,
      })),
    };
  }

  async create(
    clientId: string,
    input: { code: string; name: string; timezone?: string },
    actorId: string,
  ) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "clients" WHERE "id" = ${clientId}::uuid FOR UPDATE
        `;
        const client = await transaction.client.findUnique({
          where: { id: clientId },
          select: { id: true, status: true },
        });
        if (!client) throw new NotFoundException('Client was not found.');
        if (client.status !== 'ACTIVE') {
          throw new BadRequestException('Stores require an active client.');
        }
        const subscription = await transaction.subscription.findFirst({
          where: {
            clientId,
            deletedAt: null,
            status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
          },
          orderBy: { createdAt: 'desc' },
          select: { maxStores: true },
        });
        if (!subscription) {
          throw new BadRequestException(
            'An active subscription is required before adding a store.',
          );
        }
        const storeCount = await transaction.store.count({
          where: { clientId, status: { not: 'ARCHIVED' } },
        });
        if (storeCount >= subscription.maxStores) {
          throw new ConflictException({
            code: 'STORE_LIMIT_REACHED',
            message: `This subscription allows ${subscription.maxStores} store${subscription.maxStores === 1 ? '' : 's'}.`,
          });
        }
        const store = await transaction.store.create({
          data: {
            clientId,
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            timezone: input.timezone?.trim() || 'Asia/Manila',
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: 'client.store_created',
            resourceType: 'store',
            resourceId: store.id,
            metadata: { clientId, code: store.code },
          },
        });
        return store;
      });
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? (error as { code?: unknown }).code
          : null;
      if (code === 'P2002') {
        throw new ConflictException({
          code: 'STORE_CODE_EXISTS',
          message: 'A store with this code already exists for the client.',
        });
      }
      throw error;
    }
  }

  async update(
    clientId: string,
    storeId: string,
    input: { name?: string; timezone?: string; status?: StoreStatus },
    actorId: string,
  ) {
    const existing = await this.prisma.store.findFirst({
      where: { id: storeId, clientId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Store was not found.');
    const store = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.timezone ? { timezone: input.timezone.trim() } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'client.store_updated',
        resourceType: 'store',
        resourceId: storeId,
        metadata: { clientId, fields: Object.keys(input) },
      },
    });
    return store;
  }
}
