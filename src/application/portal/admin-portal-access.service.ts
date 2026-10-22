import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../domain/auth/auth.types.js';
import type { PortalRole } from '../../domain/portal/portal-auth.types.js';
import { webDashboardEnabled } from '../../domain/subscriptions/feature-mods.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

interface StoreSelectionQuery {
  clientId?: string;
  groupId?: string;
  search?: string;
}

interface PortalAccountInput {
  username: string;
  displayName: string;
  role: PortalRole;
  storeIds: string[];
}

@Injectable()
export class AdminPortalAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async candidates(query: StoreSelectionQuery) {
    const stores = await this.loadCandidateStores(query);
    return {
      items: stores.map((store) => this.candidate(store)),
      total: stores.length,
      eligible: stores.filter((store) => this.eligibility(store).eligible)
        .length,
    };
  }

  async users(query: StoreSelectionQuery) {
    const candidateIds = (await this.loadCandidateStores(query)).map(
      (store) => store.id,
    );
    if (!candidateIds.length) return [];
    const users = await this.prisma.portalUser.findMany({
      where: { storeAccess: { some: { storeId: { in: candidateIds } } } },
      include: {
        storeAccess: {
          include: {
            store: {
              select: {
                id: true,
                code: true,
                name: true,
                clientId: true,
                client: { select: { code: true, businessName: true } },
              },
            },
          },
        },
      },
      orderBy: { displayName: 'asc' },
    });
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      storeIds: user.storeAccess.map((access) => access.storeId),
      stores: user.storeAccess.map((access) => ({
        id: access.store.id,
        code: access.store.code,
        name: access.store.name,
        clientId: access.store.clientId,
        clientCode: access.store.client.code,
        clientName: access.store.client.businessName,
      })),
    }));
  }

  async inviteOrAddAccess(input: PortalAccountInput, actor: AuthenticatedUser) {
    const username = input.username.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const stores = await this.requireEligibleStores(input.storeIds);
    const existing = await this.prisma.portalUser.findUnique({
      where: { username },
      include: { storeAccess: { select: { storeId: true } } },
    });
    if (existing) {
      const storeIds = [
        ...new Set([
          ...existing.storeAccess.map((access) => access.storeId),
          ...stores.map((store) => store.id),
        ]),
      ];
      const user = await this.replaceAccess(
        existing.id,
        input.role,
        storeIds,
        actor,
        false,
        displayName,
      );
      return { mode: 'ACCESS_UPDATED' as const, user };
    }

    const pending = await this.prisma.portalInvitation.findFirst({
      where: {
        username,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException(
        'An active invitation already exists for this username.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const storeIds = stores.map((store) => store.id);
    const invitation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.portalInvitation.create({
        data: {
          clientId: stores[0].clientId,
          storeId: stores[0].id,
          storeIds,
          username,
          displayName,
          role: input.role,
          tokenHash: this.tokenHash(token),
          expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
          createdByDeviceId: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'portal.admin_invitation_created',
          resourceType: 'portal_invitation',
          resourceId: created.id,
          metadata: { username, storeIds, role: input.role },
        },
      });
      return created;
    });
    return {
      mode: 'INVITATION_CREATED' as const,
      invitation: {
        id: invitation.id,
        username,
        displayName,
        role: invitation.role,
        storeIds,
        expiresAt: invitation.expiresAt,
        activationToken: token,
      },
    };
  }

  async updateAccess(
    userId: string,
    input: { role: PortalRole; storeIds: string[] },
    actor: AuthenticatedUser,
  ) {
    await this.requireEligibleStores(input.storeIds);
    return this.replaceAccess(userId, input.role, input.storeIds, actor, true);
  }

  private async replaceAccess(
    userId: string,
    role: PortalRole,
    storeIds: string[],
    actor: AuthenticatedUser,
    replace: boolean,
    displayName?: string,
  ) {
    const user = await this.prisma.portalUser.findUnique({
      where: { id: userId },
      include: { storeAccess: { select: { storeId: true } } },
    });
    if (!user) throw new NotFoundException('Portal user was not found.');
    const before = user.storeAccess.map((access) => access.storeId);
    const target = [...new Set(replace ? storeIds : [...before, ...storeIds])];
    const removed = before.filter((storeId) => !target.includes(storeId));
    const roleReduced = this.roleRank(role) < this.roleRank(user.role);

    const updated = await this.prisma.$transaction(async (transaction) => {
      if (replace) {
        await transaction.portalStoreAccess.deleteMany({
          where: { portalUserId: userId, storeId: { notIn: target } },
        });
      }
      await transaction.portalStoreAccess.createMany({
        data: target.map((storeId) => ({ portalUserId: userId, storeId })),
        skipDuplicates: true,
      });
      const account = await transaction.portalUser.update({
        where: { id: userId },
        data: { role, ...(displayName ? { displayName } : {}) },
        include: { storeAccess: { select: { storeId: true } } },
      });
      if (removed.length || roleReduced) {
        await transaction.portalRefreshSession.updateMany({
          where: { portalUserId: userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ACCESS_REDUCED' },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'portal.admin_access_updated',
          resourceType: 'portal_user',
          resourceId: userId,
          metadata: { beforeStoreIds: before, afterStoreIds: target, role },
        },
      });
      return account;
    });
    return {
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      role: updated.role,
      status: updated.status,
      storeIds: updated.storeAccess.map((access) => access.storeId),
    };
  }

  private async requireEligibleStores(storeIds: string[]) {
    const uniqueIds = [...new Set(storeIds)];
    const stores = await this.loadCandidateStores({ storeIds: uniqueIds });
    if (stores.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more selected stores do not exist.',
      );
    }
    const ineligible = stores
      .map((store) => ({ store, result: this.eligibility(store) }))
      .filter(({ result }) => !result.eligible);
    if (ineligible.length) {
      throw new BadRequestException(
        `Dashboard access is unavailable for: ${ineligible
          .map(({ store, result }) => `${store.name} (${result.reason})`)
          .join(', ')}.`,
      );
    }
    return stores;
  }

  private loadCandidateStores(
    query: StoreSelectionQuery & { storeIds?: string[] },
  ) {
    return this.prisma.store.findMany({
      where: {
        ...(query.storeIds ? { id: { in: query.storeIds } } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.groupId ? { client: { groupId: query.groupId } } : {}),
        ...(query.search
          ? {
              OR: [
                {
                  name: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  code: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  client: {
                    businessName: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        client: {
          select: {
            id: true,
            code: true,
            businessName: true,
            status: true,
            groupId: true,
          },
        },
        activeSnapshot: {
          select: { snapshotCreatedAt: true, activatedAt: true },
        },
        devices: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            subscription: { select: { status: true, entitlements: true } },
          },
        },
      },
      orderBy: [{ client: { businessName: 'asc' } }, { name: 'asc' }],
    });
  }

  private candidate(
    store: Awaited<ReturnType<typeof this.loadCandidateStores>>[number],
  ) {
    const eligibility = this.eligibility(store);
    return {
      id: store.id,
      code: store.code,
      name: store.name,
      status: store.status,
      clientId: store.clientId,
      clientCode: store.client.code,
      clientName: store.client.businessName,
      groupId: store.client.groupId,
      eligible: eligibility.eligible,
      exclusionReason: eligibility.eligible ? null : eligibility.reason,
      registeredDeviceCount: store.devices.length,
      lastSnapshotAt:
        store.activeSnapshot?.snapshotCreatedAt ??
        store.activeSnapshot?.activatedAt ??
        null,
    };
  }

  private eligibility(
    store: Awaited<ReturnType<typeof this.loadCandidateStores>>[number],
  ): { eligible: boolean; reason: string } {
    if (store.status !== 'ACTIVE')
      return { eligible: false, reason: 'store inactive' };
    if (store.client.status !== 'ACTIVE') {
      return { eligible: false, reason: 'client inactive' };
    }
    if (!store.devices.length) {
      return { eligible: false, reason: 'no active registered device' };
    }
    const dashboardEnabled = store.devices.some(
      (device) =>
        device.subscription &&
        ['TRIAL', 'ACTIVE', 'GRACE'].includes(device.subscription.status) &&
        webDashboardEnabled(device.subscription.entitlements),
    );
    if (!dashboardEnabled) {
      return { eligible: false, reason: 'dashboard entitlement unavailable' };
    }
    return { eligible: true, reason: '' };
  }

  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private roleRank(role: PortalRole) {
    return { VIEWER: 1, MANAGER: 2, OWNER: 3 }[role];
  }
}
