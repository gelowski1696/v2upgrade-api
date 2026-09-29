/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { jest } from '@jest/globals';
import type { Argon2PasswordHasher } from '../../infrastructure/auth/argon2-password-hasher.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { PortalService } from './portal.service.js';

describe('PortalService refresh-token families', () => {
  const transaction = {
    portalRefreshSession: {
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    portalUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    portalRefreshSession: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    device: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const hasher = {
    verify: jest.fn(),
    hash: jest.fn(),
  };
  const jwt = { signAsync: jest.fn() };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'PORTAL_REFRESH_TOKEN_TTL_DAYS') return 30;
      if (key === 'PORTAL_ACCESS_TOKEN_TTL') return '15m';
      return fallback;
    }),
    getOrThrow: jest.fn(() => 'portal-secret-with-at-least-32-characters'),
  };
  let service: PortalService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (value: typeof transaction) => Promise<unknown>)(
          transaction,
        );
      }
      return Promise.all(input as Promise<unknown>[]);
    });
    prisma.device.findMany.mockResolvedValue([]);
    prisma.auditLog.create.mockResolvedValue({});
    transaction.auditLog.create.mockResolvedValue({});
    transaction.portalRefreshSession.update.mockResolvedValue({});
    hasher.verify.mockResolvedValue(true);
    hasher.hash.mockResolvedValue('replacement-hash');
    jwt.signAsync.mockResolvedValue('access-token');
    service = new PortalService(
      prisma as unknown as PrismaService,
      hasher as unknown as Argon2PasswordHasher,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
  });

  it('creates a new token family when the owner logs in', async () => {
    prisma.portalUser.findUnique.mockResolvedValue(portalUser());
    prisma.portalUser.update.mockResolvedValue({});
    prisma.portalRefreshSession.create.mockImplementation(
      ({ data }: { data: { id: string } }) => ({ id: data.id }),
    );

    const result = await service.login(
      'owner@example.test',
      'valid-password',
      requestContext(),
    );

    const created = prisma.portalRefreshSession.create.mock.calls[0][0].data;
    expect(created.id).toEqual(expect.any(String));
    expect(created.tokenFamilyId).toBe(created.id);
    expect(result.refreshToken.split('.')[0]).toBe(created.id);
    expect(result.refreshToken.split('.')[1]).toEqual(expect.any(String));
  });

  it('atomically rotates a refresh token within the same family', async () => {
    prisma.portalRefreshSession.findUnique.mockResolvedValue(refreshSession());
    transaction.portalRefreshSession.updateMany.mockResolvedValue({ count: 1 });
    transaction.portalRefreshSession.create.mockImplementation(
      ({ data }: { data: { id: string } }) => ({ id: data.id }),
    );

    const result = await service.refresh(
      'session-old.valid-secret',
      requestContext(),
    );

    expect(transaction.portalRefreshSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-old', revokedAt: null },
      data: expect.objectContaining({ revokedReason: 'ROTATED' }),
    });
    const replacement =
      transaction.portalRefreshSession.create.mock.calls[0][0].data;
    expect(replacement.tokenFamilyId).toBe('family-one');
    expect(transaction.portalRefreshSession.update).toHaveBeenCalledWith({
      where: { id: 'session-old' },
      data: { replacedBySessionId: replacement.id },
    });
    expect(result.refreshToken.split('.')[0]).toBe(replacement.id);
    expect(result.refreshToken.split('.')[1]).toEqual(expect.any(String));
  });

  it('revokes the active family and audits reuse of a rotated token', async () => {
    prisma.portalRefreshSession.findUnique.mockResolvedValue(
      refreshSession({
        revokedAt: new Date(Date.now() - 60_000),
        revokedReason: 'ROTATED',
        replacedBySessionId: 'session-current',
        lastUsedAt: new Date(Date.now() - 60_000),
      }),
    );
    transaction.portalRefreshSession.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.refresh('session-old.valid-secret', requestContext()),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(transaction.portalRefreshSession.updateMany).toHaveBeenCalledWith({
      where: { tokenFamilyId: 'family-one', revokedAt: null },
      data: expect.objectContaining({ revokedReason: 'REPLAY_DETECTED' }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'portal.refresh_replay_detected',
        metadata: expect.objectContaining({ tokenFamilyId: 'family-one' }),
      }),
    });
  });

  it('allows a concurrent browser request to retry the newly rotated cookie', async () => {
    prisma.portalRefreshSession.findUnique
      .mockResolvedValueOnce(refreshSession())
      .mockResolvedValueOnce(
        refreshSession({
          revokedAt: new Date(),
          revokedReason: 'ROTATED',
          replacedBySessionId: 'session-current',
          lastUsedAt: new Date(),
        }),
      );
    transaction.portalRefreshSession.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.refresh('session-old.valid-secret', requestContext()),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'portal.refresh_failed',
        metadata: expect.objectContaining({ reason: 'CONCURRENT_ROTATION' }),
      }),
    });
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('audits an invalid secret without revoking the family', async () => {
    prisma.portalRefreshSession.findUnique.mockResolvedValue(refreshSession());
    hasher.verify.mockResolvedValue(false);

    await expect(
      service.refresh('session-old.invalid-secret', requestContext()),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'portal.refresh_failed',
        metadata: expect.objectContaining({ reason: 'SECRET_MISMATCH' }),
      }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function portalUser() {
  return {
    id: 'portal-user',
    clientId: 'client-one',
    username: 'owner@example.test',
    displayName: 'Owner',
    passwordHash: 'password-hash',
    role: 'OWNER',
    status: 'ACTIVE',
    storeAccess: [{ storeId: 'store-one' }],
  };
}

function refreshSession(
  overrides: Partial<ReturnType<typeof baseRefreshSession>> = {},
) {
  return { ...baseRefreshSession(), ...overrides };
}

function baseRefreshSession() {
  return {
    id: 'session-old',
    portalUserId: 'portal-user',
    tokenHash: 'old-hash',
    tokenFamilyId: 'family-one',
    replacedBySessionId: null,
    revokedReason: null,
    userAgent: 'Old browser',
    ipAddress: '203.0.113.5',
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    createdAt: new Date(),
    user: portalUser(),
  };
}

function requestContext() {
  return { userAgent: 'Test browser', ipAddress: '203.0.113.10' };
}
