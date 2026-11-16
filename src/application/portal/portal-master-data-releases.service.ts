import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { cloudMasterDataEnabled } from '../../domain/subscriptions/feature-mods.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { MasterDataReleasesService } from '../master-data/master-data-releases.service.js';

@Injectable()
export class PortalMasterDataReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly releases: MasterDataReleasesService,
  ) {}

  async list(user: AuthenticatedPortalUser) {
    await this.requireOwnerAccess(user);
    return this.releases.list(user.clientId);
  }

  async get(user: AuthenticatedPortalUser, releaseId: string) {
    await this.requireOwnerAccess(user);
    return this.releases.get(user.clientId, releaseId);
  }

  async createDraft(
    user: AuthenticatedPortalUser,
    input: Parameters<MasterDataReleasesService['createDraft']>[1],
  ) {
    await this.requireOwnerAccess(user);
    return this.releases.createDraft(user.clientId, input, {
      kind: 'PORTAL_USER',
      id: user.id,
    });
  }

  async publish(user: AuthenticatedPortalUser, releaseId: string) {
    await this.requireOwnerAccess(user);
    return this.releases.publish(user.clientId, releaseId, {
      kind: 'PORTAL_USER',
      id: user.id,
    });
  }

  async rollback(user: AuthenticatedPortalUser, releaseId: string) {
    await this.requireOwnerAccess(user);
    return this.releases.rollback(user.clientId, releaseId, {
      kind: 'PORTAL_USER',
      id: user.id,
    });
  }

  private async requireOwnerAccess(
    user: AuthenticatedPortalUser,
  ): Promise<void> {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException(
        'Only the tenant owner can manage master data.',
      );
    }
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        clientId: user.clientId,
        deletedAt: null,
        status: { in: ['TRIAL', 'ACTIVE', 'GRACE'] },
      },
      select: { entitlements: true },
    });
    if (!subscription || !cloudMasterDataEnabled(subscription.entitlements)) {
      throw new ForbiddenException(
        'Cloud master data is not enabled for this subscription.',
      );
    }
  }
}
