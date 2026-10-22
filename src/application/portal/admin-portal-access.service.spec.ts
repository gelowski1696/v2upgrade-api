/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../../domain/auth/auth.types.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AdminPortalAccessService } from './admin-portal-access.service.js';

describe('AdminPortalAccessService', () => {
  const transaction = {
    portalInvitation: { create: jest.fn() },
    portalStoreAccess: { deleteMany: jest.fn(), createMany: jest.fn() },
    portalUser: { update: jest.fn() },
    portalRefreshSession: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    store: { findMany: jest.fn() },
    portalUser: { findUnique: jest.fn(), findMany: jest.fn() },
    portalInvitation: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: AdminPortalAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    transaction.auditLog.create.mockResolvedValue({});
    transaction.portalStoreAccess.deleteMany.mockResolvedValue({ count: 0 });
    transaction.portalStoreAccess.createMany.mockResolvedValue({ count: 0 });
    transaction.portalRefreshSession.updateMany.mockResolvedValue({ count: 0 });
    service = new AdminPortalAccessService(prisma as unknown as PrismaService);
  });

  it('resolves a client group to its member client stores', async () => {
    prisma.store.findMany.mockResolvedValue([
      eligibleStore('store-1'),
      {
        ...eligibleStore('store-2'),
        clientId: 'client-2',
        client: {
          ...eligibleStore('store-2').client,
          id: 'client-2',
          code: 'STORE-2',
          businessName: 'Second Store',
        },
      },
    ]);

    const result = await service.candidates({ groupId: 'group-1' });

    expect(prisma.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ client: { groupId: 'group-1' } }),
      }),
    );
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'store-1',
          clientId: 'client-1',
          groupId: 'group-1',
          groupName: 'Connected Stores',
        }),
        expect.objectContaining({ id: 'store-2', clientId: 'client-2' }),
      ]),
    );
  });

  it('creates one invitation containing every reviewed store', async () => {
    prisma.store.findMany.mockResolvedValue([
      eligibleStore('store-1'),
      eligibleStore('store-2'),
    ]);
    prisma.portalUser.findUnique.mockResolvedValue(null);
    prisma.portalInvitation.findFirst.mockResolvedValue(null);
    transaction.portalInvitation.create.mockImplementation(
      ({ data }: { data: object }) => ({
        id: 'invitation-1',
        role: 'OWNER',
        expiresAt: new Date('2026-10-24T00:00:00.000Z'),
        ...data,
      }),
    );

    const result = await service.inviteOrAddAccess(
      {
        username: 'Owner@Example.com',
        displayName: 'Store Owner',
        role: 'OWNER',
        storeIds: ['store-1', 'store-2'],
      },
      actor(),
    );

    expect(result.mode).toBe('INVITATION_CREATED');
    expect(transaction.portalInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: 'owner@example.com',
        storeId: 'store-1',
        storeIds: ['store-1', 'store-2'],
        createdByDeviceId: null,
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-1',
        action: 'portal.admin_invitation_created',
      }),
    });
  });

  it('adds selected stores to an existing account without duplicating it', async () => {
    prisma.store.findMany.mockResolvedValue([eligibleStore('store-2')]);
    prisma.portalUser.findUnique
      .mockResolvedValueOnce({
        id: 'portal-1',
        storeAccess: [{ storeId: 'store-1' }],
      })
      .mockResolvedValueOnce({
        id: 'portal-1',
        username: 'owner@example.com',
        displayName: 'Owner',
        storeAccess: [{ storeId: 'store-1' }],
      });
    transaction.portalUser.update.mockResolvedValue({
      id: 'portal-1',
      username: 'owner@example.com',
      displayName: 'Owner',
      role: 'OWNER',
      status: 'ACTIVE',
      storeAccess: [{ storeId: 'store-1' }, { storeId: 'store-2' }],
    });

    const result = await service.inviteOrAddAccess(
      {
        username: 'owner@example.com',
        displayName: 'Owner',
        role: 'OWNER',
        storeIds: ['store-2'],
      },
      actor(),
    );

    expect(result.mode).toBe('ACCESS_UPDATED');
    expect(transaction.portalStoreAccess.createMany).toHaveBeenCalledWith({
      data: [
        { portalUserId: 'portal-1', storeId: 'store-1' },
        { portalUserId: 'portal-1', storeId: 'store-2' },
      ],
      skipDuplicates: true,
    });
    expect(transaction.portalInvitation.create).not.toHaveBeenCalled();
  });

  it('rejects stores without an active registered dashboard device', async () => {
    prisma.store.findMany.mockResolvedValue([
      { ...eligibleStore('store-1'), devices: [] },
    ]);

    await expect(
      service.inviteOrAddAccess(
        {
          username: 'owner@example.com',
          displayName: 'Owner',
          role: 'OWNER',
          storeIds: ['store-1'],
        },
        actor(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes active sessions when stores or the account role are reduced', async () => {
    prisma.store.findMany.mockResolvedValue([eligibleStore('store-1')]);
    prisma.portalUser.findUnique.mockResolvedValue({
      id: 'portal-1',
      username: 'owner@example.com',
      displayName: 'Owner',
      role: 'OWNER',
      storeAccess: [{ storeId: 'store-1' }, { storeId: 'store-2' }],
    });
    transaction.portalUser.update.mockResolvedValue({
      id: 'portal-1',
      username: 'owner@example.com',
      displayName: 'Owner',
      role: 'VIEWER',
      status: 'ACTIVE',
      storeAccess: [{ storeId: 'store-1' }],
    });

    await service.updateAccess(
      'portal-1',
      { role: 'VIEWER', storeIds: ['store-1'] },
      actor(),
    );

    expect(transaction.portalStoreAccess.deleteMany).toHaveBeenCalledWith({
      where: { portalUserId: 'portal-1', storeId: { notIn: ['store-1'] } },
    });
    expect(transaction.portalRefreshSession.updateMany).toHaveBeenCalledWith({
      where: { portalUserId: 'portal-1', revokedAt: null },
      data: expect.objectContaining({ revokedReason: 'ACCESS_REDUCED' }),
    });
  });
});

function eligibleStore(id: string) {
  return {
    id,
    code: id.toUpperCase(),
    name: `Store ${id}`,
    status: 'ACTIVE',
    clientId: 'client-1',
    client: {
      id: 'client-1',
      code: 'CLIENT',
      businessName: 'Business',
      status: 'ACTIVE',
      groupId: 'group-1',
      group: { code: 'CONNECTED', name: 'Connected Stores' },
    },
    activeSnapshot: {
      snapshotCreatedAt: new Date('2026-10-22T00:00:00.000Z'),
      activatedAt: new Date('2026-10-22T00:00:00.000Z'),
    },
    devices: [
      {
        id: `device-${id}`,
        subscription: {
          status: 'ACTIVE',
          entitlements: { webDashboard: true },
        },
      },
    ],
  };
}

function actor(): AuthenticatedUser {
  return {
    id: 'admin-1',
    sessionId: 'session-1',
    username: 'admin',
    displayName: 'Administrator',
    role: 'SUPER_ADMIN',
  };
}
