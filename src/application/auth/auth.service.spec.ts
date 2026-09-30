import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { jest } from '@jest/globals';
import type { PasswordHasher } from '../../domain/auth/password-hasher.js';
import type { UserRepository } from '../../domain/auth/user.repository.js';
import { AuthService } from './auth.service.js';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'administrator',
  displayName: 'Subscription Admin',
  passwordHash: 'password-hash',
  role: 'SUPER_ADMIN' as const,
  status: 'ACTIVE' as const,
};

describe('AuthService browser refresh sessions', () => {
  const users = {
    findByUsername: jest.fn(),
    findById: jest.fn(),
    markLogin: jest.fn(),
    createRefreshSession: jest.fn(),
    findRefreshSession: jest.fn(),
    rotateRefreshSession: jest.fn(),
    revokeRefreshSession: jest.fn(),
    revokeRefreshFamily: jest.fn(),
  };
  const hasher = { hash: jest.fn(), verify: jest.fn() };
  const jwt = { signAsync: jest.fn() };
  const values: Record<string, unknown> = {
    WEB_REMEMBER_LOGIN_ENABLED: true,
    ADMIN_REMEMBER_LOGIN_TTL_DAYS: 30,
    ADMIN_BROWSER_SESSION_TTL_HOURS: 24,
    ADMIN_REFRESH_REUSE_GRACE_SECONDS: 5,
    JWT_ACCESS_SECRET: 'access-secret-with-at-least-32-characters',
    ACCESS_TOKEN_TTL: '15m',
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => values[key]),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    values.WEB_REMEMBER_LOGIN_ENABLED = true;
    users.findByUsername.mockResolvedValue(user);
    users.findById.mockResolvedValue(user);
    users.markLogin.mockResolvedValue(undefined);
    hasher.hash.mockResolvedValue('hashed-secret');
    hasher.verify.mockResolvedValue(true);
    jwt.signAsync.mockResolvedValue('access-token');
    users.createRefreshSession.mockImplementation((input) =>
      Promise.resolve({
        ...input,
        replacedBySessionId: null,
        revokedReason: null,
        lastUsedAt: new Date(),
        revokedAt: null,
      }),
    );
    service = new AuthService(
      users as unknown as UserRepository,
      hasher as unknown as PasswordHasher,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
  });

  it('creates a persistent browser family when remember-login is enabled', async () => {
    const before = Date.now();
    const result = await service.loginWeb('administrator', 'password', true);

    expect(result.persistent).toBe(true);
    expect(result.browserSession).toBe(true);
    expect(users.createRefreshSession).toHaveBeenCalledWith(
      expect.objectContaining({
        browserSession: true,
        persistent: true,
      }),
    );
    const input = users.createRefreshSession.mock.calls[0]?.[0] as {
      id: string;
      tokenFamilyId: string;
      expiresAt: Date;
    };
    expect(input.tokenFamilyId).toBe(input.id);
    expect(input.expiresAt.getTime() - before).toBeGreaterThan(29 * 86_400_000);
  });

  it('enforces the API feature flag even when the browser requests persistence', async () => {
    values.WEB_REMEMBER_LOGIN_ENABLED = false;

    const result = await service.loginWeb('administrator', 'password', true);

    expect(result.persistent).toBe(false);
    expect(users.createRefreshSession).toHaveBeenCalledWith(
      expect.objectContaining({ persistent: false }),
    );
  });

  it('rotates a browser session while preserving its family and persistence', async () => {
    const session = refreshSession();
    users.findRefreshSession.mockResolvedValue(session);
    users.rotateRefreshSession.mockImplementation(
      (input: {
        replacementId: string;
        tokenHash: string;
        now: Date;
        expiresAt: Date;
      }) =>
        Promise.resolve({
          ...session,
          id: input.replacementId,
          tokenHash: input.tokenHash,
          revokedAt: null,
          revokedReason: null,
          replacedBySessionId: null,
          lastUsedAt: input.now,
          expiresAt: input.expiresAt,
        }),
    );

    const result = await service.refreshWeb(`${session.id}.secret`);

    expect(result.persistent).toBe(true);
    expect(users.rotateRefreshSession).toHaveBeenCalledWith(
      expect.objectContaining({
        currentId: session.id,
        tokenFamilyId: session.tokenFamilyId,
        browserSession: true,
        persistent: true,
      }),
    );
  });

  it('rejects a recently rotated token as a benign concurrent conflict', async () => {
    users.findRefreshSession.mockResolvedValue({
      ...refreshSession(),
      revokedAt: new Date(),
      revokedReason: 'ROTATED',
      lastUsedAt: new Date(),
    });

    await expect(
      service.refreshWeb('session-id.secret'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.revokeRefreshFamily).not.toHaveBeenCalled();
  });

  it('revokes the active token family when an older rotated credential is replayed', async () => {
    users.findRefreshSession.mockResolvedValue({
      ...refreshSession(),
      revokedAt: new Date(Date.now() - 60_000),
      revokedReason: 'ROTATED',
      lastUsedAt: new Date(Date.now() - 60_000),
    });
    users.revokeRefreshFamily.mockResolvedValue(1);

    await expect(
      service.refreshWeb('session-id.secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.revokeRefreshFamily).toHaveBeenCalledWith(
      'family-id',
      'REPLAY_DETECTED',
    );
  });
});

function refreshSession() {
  return {
    id: 'session-id',
    userId: user.id,
    tokenHash: 'hashed-secret',
    tokenFamilyId: 'family-id',
    replacedBySessionId: null,
    revokedReason: null,
    browserSession: true,
    persistent: true,
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
  };
}
