import { ConflictException, ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { PortalTenantUsersService } from './portal-tenant-users.service.js';

describe('PortalTenantUsersService', () => {
  const transaction = {
    portalInvitation: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    portalUser: { findMany: jest.fn(), findUnique: jest.fn() },
    portalInvitation: { findFirst: jest.fn() },
    store: { findMany: jest.fn() },
    subscription: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: PortalTenantUsersService;
  const owner = {
    id: 'portal-owner',
    sessionId: 'session-1',
    clientId: 'client-1',
    username: 'owner@example.test',
    displayName: 'Owner',
    role: 'OWNER',
    storeIds: ['store-main'],
  } as AuthenticatedPortalUser;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    prisma.subscription.findFirst.mockResolvedValue({ id: 'subscription-1' });
    prisma.store.findMany.mockResolvedValue([
      { id: 'store-main', clientId: 'client-1', status: 'ACTIVE' },
      { id: 'store-north', clientId: 'client-1', status: 'ACTIVE' },
    ]);
    prisma.portalUser.findUnique.mockResolvedValue(null);
    prisma.portalInvitation.findFirst.mockResolvedValue(null);
    transaction.portalInvitation.create.mockResolvedValue({
      id: 'invitation-1',
      role: 'MANAGER',
      expiresAt: new Date('2026-11-17T00:00:00.000Z'),
    });
    transaction.auditLog.create.mockResolvedValue({});
    service = new PortalTenantUsersService(prisma as unknown as PrismaService);
  });

  it('creates a tenant-scoped invitation with explicit store assignments', async () => {
    const result = await service.createInvitation(owner, {
      username: ' manager@example.test ',
      displayName: ' Store Manager ',
      role: 'MANAGER',
      storeIds: ['store-main', 'store-north'],
    });

    expect(result.mode).toBe('INVITATION_CREATED');
    expect(result.invitation.storeIds).toEqual(['store-main', 'store-north']);
    expect(transaction.portalInvitation.create.mock.calls[0]?.[0].data).toEqual(
      expect.objectContaining({
        clientId: 'client-1',
        storeId: 'store-main',
        storeIds: ['store-main', 'store-north'],
        username: 'manager@example.test',
        role: 'MANAGER',
        createdByDeviceId: null,
      }),
    );
  });

  it('rejects invitations from non-owner portal users', async () => {
    await expect(
      service.createInvitation(
        { ...owner, role: 'MANAGER' },
        {
          username: 'viewer@example.test',
          displayName: 'Viewer',
          role: 'VIEWER',
          storeIds: ['store-main'],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not expose the tenant user directory to viewers', async () => {
    await expect(
      service.list({ ...owner, role: 'VIEWER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.portalUser.findMany).not.toHaveBeenCalled();
  });

  it('rejects a store assignment outside the tenant', async () => {
    prisma.store.findMany.mockResolvedValue([
      { id: 'store-main', clientId: 'client-1', status: 'ACTIVE' },
    ]);

    await expect(
      service.createInvitation(owner, {
        username: 'viewer@example.test',
        displayName: 'Viewer',
        role: 'VIEWER',
        storeIds: ['store-other'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a duplicate account or pending invitation', async () => {
    prisma.portalUser.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      service.createInvitation(owner, {
        username: 'existing@example.test',
        displayName: 'Existing',
        role: 'VIEWER',
        storeIds: ['store-main'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
