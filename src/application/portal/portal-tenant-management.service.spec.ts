import { ConflictException, ForbiddenException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { PortalTenantManagementService } from './portal-tenant-management.service.js';

describe('PortalTenantManagementService', () => {
  const transaction = {
    $queryRaw: jest.fn(),
    client: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    store: { count: jest.fn(), create: jest.fn() },
    portalStoreAccess: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  let service: PortalTenantManagementService;

  const owner = {
    id: 'portal-user-1',
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
    transaction.client.findUnique.mockResolvedValue({
      id: 'client-1',
      status: 'ACTIVE',
    });
    transaction.subscription.findFirst.mockResolvedValue({
      id: 'subscription-1',
      maxStores: 3,
    });
    transaction.store.count.mockResolvedValue(1);
    transaction.store.create.mockResolvedValue({
      id: 'store-2',
      clientId: 'client-1',
      code: 'NORTH',
      name: 'North Branch',
      timezone: 'Asia/Manila',
      status: 'ACTIVE',
    });
    transaction.portalStoreAccess.create.mockResolvedValue({});
    transaction.auditLog.create.mockResolvedValue({});
    service = new PortalTenantManagementService(
      prisma as unknown as PrismaService,
    );
  });

  it('creates a branch from the owner tenant scope and grants the owner access', async () => {
    const result = await service.createStore(owner, {
      code: ' north ',
      name: ' North Branch ',
      timezone: 'Asia/Manila',
    });

    expect(result.id).toBe('store-2');
    expect(transaction.store.create.mock.calls[0]?.[0].data).toEqual({
      clientId: 'client-1',
      code: 'NORTH',
      name: 'North Branch',
      timezone: 'Asia/Manila',
    });
    expect(transaction.portalStoreAccess.create).toHaveBeenCalledWith({
      data: { portalUserId: 'portal-user-1', storeId: 'store-2' },
    });
  });

  it('rejects branch creation for non-owner portal users', async () => {
    await expect(
      service.createStore(
        { ...owner, role: 'MANAGER' },
        {
          code: 'NORTH',
          name: 'North Branch',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects branch creation when the plan store quota is reached', async () => {
    transaction.store.count.mockResolvedValue(3);

    await expect(
      service.createStore(owner, { code: 'NORTH', name: 'North Branch' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.store.create).not.toHaveBeenCalled();
  });
});
