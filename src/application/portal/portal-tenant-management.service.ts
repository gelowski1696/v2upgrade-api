import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';

const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE'] as const;

export interface CreatePortalStoreInput {
  code: string;
  name: string;
  timezone?: string;
}

@Injectable()
export class PortalTenantManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async createStore(
    user: AuthenticatedPortalUser,
    input: CreatePortalStoreInput,
  ) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the tenant owner can add a branch.');
    }

    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    const timezone = input.timezone?.trim() || 'Asia/Manila';
    if (
      !code ||
      code.length > 40 ||
      !name ||
      name.length > 180 ||
      timezone.length > 80
    ) {
      throw new BadRequestException(
        'Enter a valid branch code, name, and timezone.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "clients" WHERE "id" = ${user.clientId}::uuid FOR UPDATE
      `;
      const client = await transaction.client.findUnique({
        where: { id: user.clientId },
        select: { id: true, status: true },
      });
      if (!client) throw new NotFoundException('Business was not found.');
      if (client.status !== 'ACTIVE') {
        throw new ForbiddenException('This business is not active.');
      }

      const subscription = await transaction.subscription.findFirst({
        where: {
          clientId: user.clientId,
          deletedAt: null,
          status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
        },
        select: { id: true, maxStores: true },
      });
      if (!subscription) {
        throw new ForbiddenException(
          'An active subscription is required to add a branch.',
        );
      }

      const storeCount = await transaction.store.count({
        where: { clientId: user.clientId, status: { not: 'ARCHIVED' } },
      });
      if (storeCount >= subscription.maxStores) {
        throw new ConflictException(
          'The store limit for this subscription has been reached.',
        );
      }

      let store;
      try {
        store = await transaction.store.create({
          data: { clientId: user.clientId, code, name, timezone },
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new ConflictException(
            'A branch with this code already exists.',
          );
        }
        throw error;
      }

      await transaction.portalStoreAccess.create({
        data: { portalUserId: user.id, storeId: store.id },
      });
      await transaction.auditLog.create({
        data: {
          action: 'portal.store_created',
          resourceType: 'store',
          resourceId: store.id,
          metadata: { portalUserId: user.id, clientId: user.clientId },
        },
      });
      return store;
    });
  }
}
