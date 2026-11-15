import { ConflictException, BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { MasterDataReleasesService } from './master-data-releases.service.js';

describe('MasterDataReleasesService', () => {
  const transaction = {
    $queryRaw: jest.fn(),
    client: { findUnique: jest.fn() },
    subscription: { findFirst: jest.fn() },
    masterDataRelease: {
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    masterDataReleaseEntry: { createMany: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    masterDataRelease: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: MasterDataReleasesService;

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
    });
    transaction.masterDataRelease.aggregate.mockResolvedValue({
      _max: { version: 2 },
    });
    transaction.masterDataRelease.create.mockResolvedValue({
      id: 'release-3',
      clientId: 'client-1',
      version: 3,
      status: 'DRAFT',
    });
    transaction.masterDataReleaseEntry.createMany.mockResolvedValue({
      count: 1,
    });
    transaction.masterDataReleaseEntry.findMany.mockResolvedValue([
      {
        entityType: 'PRODUCT',
        operation: 'UPSERT',
        stableKey: 'PRODUCT-11KG',
        payload: { name: 'LPG 11kg' },
      },
    ]);
    transaction.auditLog.create.mockResolvedValue({});
    service = new MasterDataReleasesService(prisma as unknown as PrismaService);
  });

  it('creates a tenant-scoped draft with a monotonic version', async () => {
    const result = await service.createDraft(
      'client-1',
      {
        entries: [
          {
            entityType: 'PRODUCT',
            operation: 'UPSERT',
            stableKey: ' product-11kg ',
            payload: { name: 'LPG 11kg' },
          },
        ],
        notes: 'Initial catalog',
      },
      'admin-1',
    );

    expect(result.version).toBe(3);
    expect(transaction.masterDataRelease.create.mock.calls[0]?.[0]).toEqual({
      data: expect.objectContaining({
        clientId: 'client-1',
        version: 3,
        status: 'DRAFT',
        notes: 'Initial catalog',
        entries: {
          create: [expect.objectContaining({ stableKey: 'PRODUCT-11KG' })],
        },
      }),
      include: { entries: true },
    });
    expect(transaction.$queryRaw).toHaveBeenCalled();
  });

  it('rejects a release when the tenant has no active subscription', async () => {
    transaction.subscription.findFirst.mockResolvedValue(null);

    await expect(
      service.createDraft(
        'client-1',
        {
          entries: [
            {
              entityType: 'PRODUCT',
              operation: 'UPSERT',
              stableKey: 'PRODUCT-11KG',
              payload: { name: 'LPG 11kg' },
            },
          ],
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate entity keys within one release', async () => {
    await expect(
      service.createDraft(
        'client-1',
        {
          entries: [
            {
              entityType: 'PRODUCT',
              operation: 'UPSERT',
              stableKey: 'PRODUCT-11KG',
              payload: { name: 'A' },
            },
            {
              entityType: 'PRODUCT',
              operation: 'UPSERT',
              stableKey: 'product-11kg',
              payload: { name: 'B' },
            },
          ],
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
