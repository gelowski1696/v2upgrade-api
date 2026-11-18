import {
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { DeviceEnrollmentService } from './device-enrollment.service.js';

describe('DeviceEnrollmentService', () => {
  const transaction = {
    $queryRaw: jest.fn(),
    store: { findFirst: jest.fn() },
    subscription: { findFirst: jest.fn() },
    device: { count: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    deviceEnrollmentCode: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    store: { findFirst: jest.fn() },
    device: { findMany: jest.fn() },
    deviceEnrollmentCode: { findMany: jest.fn() },
  };
  const jwt = { signAsync: jest.fn() };
  const config = { get: jest.fn(), getOrThrow: jest.fn() };
  const owner = {
    id: 'portal-user-1',
    clientId: 'client-1',
    role: 'OWNER',
    storeIds: ['store-1'],
  } as AuthenticatedPortalUser;
  let service: DeviceEnrollmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (value: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    );
    config.get.mockImplementation((key: string, fallback: unknown) =>
      key === 'DEVICE_ENROLLMENT_TTL_MINUTES' ? 30 : fallback,
    );
    config.getOrThrow.mockReturnValue('a-secure-device-jwt-secret-for-tests');
    jwt.signAsync.mockResolvedValue('device-access-token');
    transaction.store.findFirst.mockResolvedValue({
      id: 'store-1',
      code: 'MAIN',
      name: 'Main Branch',
      status: 'ACTIVE',
    });
    transaction.subscription.findFirst.mockResolvedValue({
      id: 'subscription-1',
      maxDevices: 2,
      entitlements: { cloudMasterData: true },
      status: 'ACTIVE',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
      graceEndsAt: null,
      client: { businessName: 'Test Business', status: 'ACTIVE' },
      planVersion: { plan: { name: 'Cloud POS' } },
    });
    transaction.device.count.mockResolvedValue(0);
    transaction.device.findUnique.mockResolvedValue(null);
    transaction.device.create.mockResolvedValue({
      id: 'device-1',
      clientId: 'client-1',
      storeId: 'store-1',
      subscriptionId: 'subscription-1',
      installationId: 'POS-12345678',
      label: 'Front counter',
    });
    transaction.deviceEnrollmentCode.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'enrollment-1',
        ...data,
        createdAt: new Date('2026-11-18T01:00:00.000Z'),
      }),
    );
    transaction.auditLog.create.mockResolvedValue({});
    service = new DeviceEnrollmentService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
  });

  it('creates a one-time code from trusted owner and store scope', async () => {
    const result = await service.create(owner, 'store-1', {
      label: 'Front counter',
      expiresInMinutes: 30,
    });

    expect(result.enrollmentCode).toMatch(/^VMJAM-[A-Z0-9-]+$/);
    const createInput = transaction.deviceEnrollmentCode.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(createInput.data).toMatchObject({
      clientId: 'client-1',
      subscriptionId: 'subscription-1',
      storeId: 'store-1',
      label: 'Front counter',
      createdByPortalUserId: 'portal-user-1',
    });
    expect(createInput.data).not.toHaveProperty('enrollmentCode');
    expect(String(createInput.data['tokenHash'])).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not allow a manager to create device credentials', async () => {
    await expect(
      service.create({ ...owner, role: 'MANAGER' }, 'store-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('consumes a valid code once and issues a scoped device token', async () => {
    const codeRecord = {
      id: 'enrollment-1',
      clientId: 'client-1',
      subscriptionId: 'subscription-1',
      storeId: 'store-1',
      label: 'Front counter',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      revokedAt: null,
      store: { id: 'store-1', code: 'MAIN', name: 'Main Branch', status: 'ACTIVE' },
      subscription: await transaction.subscription.findFirst(),
    };
    transaction.deviceEnrollmentCode.findUnique.mockResolvedValue(codeRecord);
    transaction.deviceEnrollmentCode.update.mockResolvedValue({});

    const result = await service.consume({
      enrollmentCode: 'VMJAM-ABCD-EFGH-IJKL-MNOP-QRST',
      installationId: 'POS-12345678',
      appVersion: '0.2.9',
      platform: 'windows',
    });

    expect(result.deviceAccessToken).toBe('device-access-token');
    expect(result.store).toEqual({ id: 'store-1', code: 'MAIN', name: 'Main Branch' });
    expect(transaction.deviceEnrollmentCode.update).toHaveBeenCalledWith({
      where: { id: 'enrollment-1' },
      data: expect.objectContaining({ consumedByDeviceId: 'device-1' }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'device-1',
        clientId: 'client-1',
        storeId: 'store-1',
        tokenUse: 'device-sync',
      }),
      expect.any(Object),
    );
  });

  it('fails closed for expired and replayed codes', async () => {
    const base = {
      id: 'enrollment-1',
      clientId: 'client-1',
      subscriptionId: 'subscription-1',
      storeId: 'store-1',
      label: null,
      revokedAt: null,
      store: { id: 'store-1', code: 'MAIN', name: 'Main', status: 'ACTIVE' },
      subscription: await transaction.subscription.findFirst(),
    };
    transaction.deviceEnrollmentCode.findUnique.mockResolvedValue({
      ...base,
      expiresAt: new Date(Date.now() - 1),
      consumedAt: null,
    });
    await expect(
      service.consume({
        enrollmentCode: 'VMJAM-ABCD-EFGH-IJKL-MNOP-QRST',
        installationId: 'POS-12345678',
        platform: 'windows',
      }),
    ).rejects.toBeInstanceOf(GoneException);

    transaction.deviceEnrollmentCode.findUnique.mockResolvedValue({
      ...base,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
    });
    await expect(
      service.consume({
        enrollmentCode: 'VMJAM-ABCD-EFGH-IJKL-MNOP-QRST',
        installationId: 'POS-12345678',
        platform: 'windows',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.device.create).not.toHaveBeenCalled();
  });
});
