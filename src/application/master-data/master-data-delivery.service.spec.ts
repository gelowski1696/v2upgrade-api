import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import { MasterDataDeliveryService } from './master-data-delivery.service.js';

describe('MasterDataDeliveryService', () => {
  const device: AuthenticatedDevice = {
    id: 'device-1',
    clientId: 'client-1',
    storeId: 'store-1',
    installationId: 'POS-12345678',
  };
  const release = {
    id: 'release-1',
    clientId: 'client-1',
    version: 2,
    status: 'PUBLISHED',
    releaseHash: 'a'.repeat(64),
    notes: 'Pilot catalog',
    publishedAt: new Date('2026-11-18T01:00:00.000Z'),
    _count: { entries: 2 },
    entries: [
      {
        entityType: 'PRODUCT',
        operation: 'UPSERT',
        stableKey: 'LPG-11KG',
        payload: { name: '11 kg LPG', code: 'LPG-11' },
      },
    ],
  };
  const transaction = {
    masterDataDeviceAcknowledgement: { upsert: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    masterDataRelease: { findFirst: jest.fn() },
    device: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const config = { get: jest.fn() };
  let service: MasterDataDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((_key: string, fallback: string) => fallback);
    prisma.$transaction.mockImplementation(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    transaction.masterDataDeviceAcknowledgement.upsert.mockResolvedValue({
      status: 'VALIDATED',
      acknowledgedAt: new Date('2026-11-18T02:00:00.000Z'),
    });
    transaction.auditLog.create.mockResolvedValue({});
    prisma.device.findFirst.mockResolvedValue({
      subscription: { entitlements: { cloudMasterData: true } },
    });
    service = new MasterDataDeliveryService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('returns only the latest published release in the device tenant', async () => {
    prisma.masterDataRelease.findFirst.mockResolvedValue(release);
    const result = await service.current(device);
    expect(result).toMatchObject({
      available: true,
      storeId: 'store-1',
      release: {
        id: 'release-1',
        version: 2,
        entryCount: 2,
        contentHash: 'd7108bb5df7796db049df9dcbd534cb129079985948787ef07954aa4695caf4a',
      },
    });
    expect(prisma.masterDataRelease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientId: 'client-1', status: 'PUBLISHED' } }),
    );
  });

  it('refuses a release outside the authenticated device tenant', async () => {
    prisma.masterDataRelease.findFirst.mockResolvedValue(null);
    await expect(service.download(device, 'other-release')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('records validation without accepting a client-supplied device or store', async () => {
    prisma.masterDataRelease.findFirst.mockResolvedValue({ id: 'release-1', version: 2 });
    await service.acknowledge(device, 'release-1', {
      status: 'VALIDATED',
      applicationVersion: '0.2.9',
    });
    expect(transaction.masterDataDeviceAcknowledgement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deviceId: 'device-1',
          releaseId: 'release-1',
          status: 'VALIDATED',
        }),
      }),
    );
  });
});
