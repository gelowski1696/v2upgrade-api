import { BadRequestException, ConflictException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { ClientStoresService } from './client-stores.service.js';

describe('ClientStoresService', () => {
  const transaction = {
    $queryRaw: jest.fn(),
    client: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    store: { count: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    client: { findUnique: jest.fn() },
    store: { findMany: jest.fn() },
    subscription: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: ClientStoresService;

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
    transaction.subscription.findFirst.mockResolvedValue({ maxStores: 2 });
    transaction.store.count.mockResolvedValue(1);
    transaction.store.create.mockResolvedValue(storeRecord('branch'));
    transaction.auditLog.create.mockResolvedValue({});
    service = new ClientStoresService(prisma as unknown as PrismaService);
  });

  it('creates a normalized branch while the tenant is below its quota', async () => {
    const result = await service.create(
      'client-1',
      {
        code: ' north ',
        name: ' North Branch ',
        timezone: 'Asia/Manila',
      },
      'admin-1',
    );

    expect(result.code).toBe('BRANCH');
    expect(transaction.store.create.mock.calls[0]?.[0]).toEqual({
      data: {
        clientId: 'client-1',
        code: 'NORTH',
        name: 'North Branch',
        timezone: 'Asia/Manila',
      },
    });
    expect(transaction.auditLog.create.mock.calls[0]?.[0]).toEqual({
      data: expect.objectContaining({
        actorId: 'admin-1',
        action: 'client.store_created',
      }),
    });
  });

  it('rejects branch creation when the subscription store quota is reached', async () => {
    transaction.store.count.mockResolvedValue(2);

    await expect(
      service.create(
        'client-1',
        { code: 'NORTH', name: 'North Branch' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.store.create.mock.calls).toHaveLength(0);
  });

  it('rejects branch creation without an active tenant subscription', async () => {
    transaction.subscription.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        'client-1',
        { code: 'NORTH', name: 'North Branch' },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function storeRecord(code: string) {
  return {
    id: `store-${code}`,
    clientId: 'client-1',
    code: code.toUpperCase(),
    name: `${code} Store`,
    status: 'ACTIVE',
    timezone: 'Asia/Manila',
    activeSnapshotId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
