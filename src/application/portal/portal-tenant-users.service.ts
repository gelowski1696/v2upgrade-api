import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type {
  AuthenticatedPortalUser,
  PortalRole,
} from '../../domain/portal/portal-auth.types.js';

export interface CreatePortalInvitationInput {
  username: string;
  displayName: string;
  role: PortalRole;
  storeIds: string[];
}

@Injectable()
export class PortalTenantUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedPortalUser) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the tenant owner can manage web users.',
      );
    }
    return this.prisma.portalUser.findMany({
      where: { clientId: user.clientId },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        storeAccess: {
          select: {
            storeId: true,
            store: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { displayName: 'asc' },
    });
  }

  async createInvitation(
    user: AuthenticatedPortalUser,
    input: CreatePortalInvitationInput,
  ) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the tenant owner can invite web users.',
      );
    }
    const username = input.username.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const storeIds = [...new Set(input.storeIds)];
    if (!username || !displayName || !storeIds.length) {
      throw new ForbiddenException(
        'A username, display name, and at least one branch are required.',
      );
    }

    const stores = await this.prisma.store.findMany({
      where: {
        id: { in: storeIds },
        clientId: user.clientId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    const authorizedStoreIds = new Set(stores.map((store) => store.id));
    if (storeIds.some((storeId) => !authorizedStoreIds.has(storeId))) {
      throw new ForbiddenException(
        'One or more selected branches are not available to this tenant.',
      );
    }
    const existing = await this.prisma.portalUser.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException(
        'A portal account already uses this username.',
      );
    const pending = await this.prisma.portalInvitation.findFirst({
      where: {
        username,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pending)
      throw new ConflictException(
        'An active invitation already exists for this username.',
      );

    const token = randomBytes(32).toString('base64url');
    const invitation = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.portalInvitation.create({
        data: {
          clientId: user.clientId,
          storeId: storeIds[0],
          storeIds,
          username,
          displayName,
          role: input.role,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
          createdByDeviceId: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'portal.owner_invitation_created',
          resourceType: 'portal_invitation',
          resourceId: created.id,
          metadata: {
            portalUserId: user.id,
            clientId: user.clientId,
            storeIds,
            role: input.role,
          },
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
}
