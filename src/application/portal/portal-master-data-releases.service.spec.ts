import { ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import type { MasterDataReleasesService } from '../master-data/master-data-releases.service.js';
import { PortalMasterDataReleasesService } from './portal-master-data-releases.service.js';

describe('PortalMasterDataReleasesService', () => {
  const prisma = { subscription: { findFirst: jest.fn() } };
  const releases = {
    list: jest.fn(),
    get: jest.fn(),
    createDraft: jest.fn(),
    publish: jest.fn(),
    rollback: jest.fn(),
  };
  const owner = {
    id: 'portal-owner',
    sessionId: 'session-1',
    clientId: 'client-1',
    username: 'owner@example.test',
    displayName: 'Owner',
    role: 'OWNER',
    storeIds: ['store-main'],
  } as AuthenticatedPortalUser;
  let service: PortalMasterDataReleasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.subscription.findFirst.mockResolvedValue({
      entitlements: { webDashboard: true },
    });
    releases.list.mockResolvedValue([]);
    service = new PortalMasterDataReleasesService(
      prisma as unknown as PrismaService,
      releases as unknown as MasterDataReleasesService,
    );
  });

  it('derives the tenant from the owner portal session', async () => {
    await service.list(owner);
    expect(releases.list).toHaveBeenCalledWith('client-1');
  });

  it('rejects a viewer before calling the release service', async () => {
    await expect(
      service.list({ ...owner, role: 'VIEWER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(releases.list).not.toHaveBeenCalled();
  });

  it('rejects a subscription that explicitly disables cloud masters', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
      entitlements: { cloudMasterData: false },
    });

    await expect(service.list(owner)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
