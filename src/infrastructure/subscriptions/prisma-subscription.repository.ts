import { Injectable } from '@nestjs/common';
import type { Page, PageQuery } from '../../domain/shared/page.js';
import { toPage } from '../../domain/shared/page.js';
import type {
  CreateSubscriptionInput,
  DeviceLicenseRecord,
  SubscriptionEventRecord,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionStatus,
} from '../../domain/subscriptions/subscription.repository.js';
import { ConflictError } from '../../domain/shared/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

const subscriptionInclude = {
  client: { select: { id: true, code: true, businessName: true } },
  planVersion: {
    select: {
      id: true,
      version: true,
      plan: { select: { id: true, code: true, name: true } },
    },
  },
  devices: {
    orderBy: { createdAt: 'asc' as const },
    take: 1,
    select: {
      id: true,
      installationId: true,
      label: true,
      platform: true,
      status: true,
      lastSeenAt: true,
    },
  },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: typeof subscriptionInclude;
}>;

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: PageQuery & { status?: SubscriptionStatus; clientId?: string },
  ): Promise<Page<SubscriptionRecord>> {
    const where: Prisma.SubscriptionWhereInput = {
      status: query.status,
      clientId: query.clientId,
      ...(query.search
        ? {
            OR: [
              {
                client: {
                  code: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                client: {
                  businessName: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                planVersion: {
                  plan: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        include: subscriptionInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return toPage(
      items.map((item) => this.map(item)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findById(id: string): Promise<SubscriptionRecord | null> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: subscriptionInclude,
    });
    return subscription ? this.map(subscription) : null;
  }

  async findByDeviceId(
    deviceInstallationId: string,
  ): Promise<DeviceLicenseRecord | null> {
    const device = await this.prisma.device.findUnique({
      where: { installationId: deviceInstallationId },
      include: {
        subscription: { include: subscriptionInclude },
      },
    });
    if (!device) return null;
    return {
      id: device.id,
      clientId: device.clientId,
      storeId: device.storeId,
      installationId: device.installationId,
      status: device.status,
      subscription: device.subscription ? this.map(device.subscription) : null,
    };
  }

  async touchDevice(id: string, seenAt: Date): Promise<void> {
    await this.prisma.device.update({
      where: { id },
      data: { lastSeenAt: seenAt },
    });
  }

  async assignDevice(
    subscriptionId: string,
    clientId: string,
    deviceInstallationId: string,
  ): Promise<SubscriptionRecord> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const store = await transaction.store.findFirstOrThrow({
          where: { clientId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const existing = await transaction.device.findFirst({
          where: { subscriptionId },
          select: { id: true },
        });
        if (existing) {
          await transaction.device.update({
            where: { id: existing.id },
            data: {
              installationId: deviceInstallationId,
              storeId: store.id,
              status: 'ACTIVE',
              revokedAt: null,
            },
          });
        } else {
          await transaction.device.create({
            data: {
              subscriptionId,
              clientId,
              storeId: store.id,
              installationId: deviceInstallationId,
              label: 'Primary POS',
              platform: 'windows',
            },
          });
        }
      });
    } catch (error) {
      this.rethrowDeviceConflict(error);
    }
    return (await this.findById(subscriptionId)) as SubscriptionRecord;
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const { deviceInstallationId, ...subscriptionInput } = input;
    try {
      const store = await this.prisma.store.findFirstOrThrow({
        where: { clientId: input.clientId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const subscription = await this.prisma.subscription.create({
        data: {
          ...subscriptionInput,
          entitlements: input.entitlements as Prisma.InputJsonValue,
          devices: {
            create: {
              clientId: input.clientId,
              storeId: store.id,
              installationId: deviceInstallationId,
              label: 'Primary POS',
              platform: 'windows',
            },
          },
          events: {
            create: {
              toStatus: 'DRAFT',
              reason: 'Subscription created',
              actorId: input.createdById,
            },
          },
        },
        include: subscriptionInclude,
      });
      return this.map(subscription);
    } catch (error) {
      this.rethrowDeviceConflict(error);
    }
  }

  async transition(
    id: string,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
    actorId: string,
    reason?: string,
  ): Promise<SubscriptionRecord> {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.subscription.updateMany({
        where: { id, status: fromStatus },
        data: {
          status: toStatus,
          suspendedAt: toStatus === 'SUSPENDED' ? new Date() : undefined,
          cancelledAt: toStatus === 'CANCELLED' ? new Date() : undefined,
        },
      });
      if (result.count !== 1) {
        throw new Error('SUBSCRIPTION_CONCURRENT_CHANGE');
      }
      await transaction.subscriptionEvent.create({
        data: { subscriptionId: id, fromStatus, toStatus, reason, actorId },
      });
    });
    return (await this.findById(id)) as SubscriptionRecord;
  }

  async renew(
    id: string,
    fromStatus: SubscriptionStatus,
    startsAt: Date,
    expiresAt: Date,
    actorId: string,
    reason?: string,
  ): Promise<SubscriptionRecord> {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.subscription.updateMany({
        where: { id, status: fromStatus },
        data: {
          status: 'ACTIVE',
          startsAt,
          renewsAt: expiresAt,
          expiresAt,
          graceEndsAt: null,
          suspendedAt: null,
          cancelledAt: null,
        },
      });
      if (result.count !== 1) {
        throw new Error('SUBSCRIPTION_CONCURRENT_CHANGE');
      }
      await transaction.subscriptionEvent.create({
        data: {
          subscriptionId: id,
          fromStatus,
          toStatus: 'ACTIVE',
          reason: reason ?? 'Subscription renewed',
          actorId,
          metadata: { startsAt, expiresAt },
        },
      });
    });
    return (await this.findById(id)) as SubscriptionRecord;
  }

  async events(id: string): Promise<SubscriptionEventRecord[]> {
    return this.prisma.subscriptionEvent.findMany({
      where: { subscriptionId: id },
      select: {
        id: true,
        subscriptionId: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private map(subscription: SubscriptionWithRelations): SubscriptionRecord {
    const { devices, ...record } = subscription;
    return {
      ...record,
      amount: subscription.amount.toFixed(2),
      entitlements: subscription.entitlements as Record<string, unknown>,
      device: devices[0] ?? null,
    };
  }

  private rethrowDeviceConflict(error: unknown): never {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : null;
    if (errorCode === 'P2002') {
      throw new ConflictError(
        'Device ID is already assigned to another subscription.',
        'DEVICE_ALREADY_ASSIGNED',
      );
    }
    throw error;
  }
}
