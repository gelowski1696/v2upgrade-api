import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { jest } from '@jest/globals';
import type { PortalService } from '../../../application/portal/portal.service.js';
import { PortalAuthController } from './portal-auth.controller.js';

const browserResult = {
  accessToken: 'access-token',
  refreshToken: 'session-id.refresh-secret',
  user: {
    id: 'user-id',
    sessionId: 'session-id',
    clientId: 'client-id',
    username: 'owner@example.test',
    displayName: 'Owner',
    role: 'OWNER' as const,
    storeIds: ['store-id'],
  },
};

describe('PortalAuthController browser sessions', () => {
  const portal = {
    login: jest.fn(),
    activate: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'PORTAL_WEB_ORIGINS') return 'https://vmjamdocuai.cloud';
      if (key === 'NODE_ENV') return 'production';
      if (key === 'PORTAL_REFRESH_TOKEN_TTL_DAYS') return 30;
      return fallback;
    }),
  };
  let controller: PortalAuthController;
  let response: Pick<Response, 'cookie' | 'clearCookie'>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PortalAuthController(
      portal as unknown as PortalService,
      config as unknown as ConfigService,
    );
    response = {
      cookie: jest.fn() as unknown as Response['cookie'],
      clearCookie: jest.fn() as unknown as Response['clearCookie'],
    };
  });

  it('sets a host-only HttpOnly cookie and omits the refresh token from login JSON', async () => {
    portal.login.mockResolvedValue(browserResult);

    const result = await controller.loginWeb(
      { username: 'owner@example.test', password: 'password' },
      request(),
      response as Response,
    );

    expect(result).toEqual({
      accessToken: browserResult.accessToken,
      user: browserResult.user,
    });
    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-posv2-portal-refresh',
      browserResult.refreshToken,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 30 * 86_400_000,
      }),
    );
  });

  it('reads and rotates the refresh credential from the cookie', async () => {
    portal.refresh.mockResolvedValue(browserResult);

    await controller.refreshWeb(
      request(
        `other=value; __Host-posv2-portal-refresh=${browserResult.refreshToken}`,
      ),
      response as Response,
    );

    expect(portal.refresh).toHaveBeenCalledWith(
      browserResult.refreshToken,
      expect.objectContaining({ ipAddress: '203.0.113.10' }),
    );
    expect(response.cookie).toHaveBeenCalled();
  });

  it('rejects browser auth requests without the custom CSRF header', async () => {
    await expect(
      controller.loginWeb(
        { username: 'owner@example.test', password: 'password' },
        request(undefined, { csrf: false }),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(portal.login).not.toHaveBeenCalled();
  });

  it('rejects browser auth requests from an origin outside the allowlist', async () => {
    await expect(
      controller.loginWeb(
        { username: 'owner@example.test', password: 'password' },
        request(undefined, { origin: 'https://attacker.example' }),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(portal.login).not.toHaveBeenCalled();
  });

  it('clears the browser cookie when refresh is rejected', async () => {
    portal.refresh.mockRejectedValue(new Error('Refresh rejected'));

    await expect(
      controller.refreshWeb(
        request(`__Host-posv2-portal-refresh=${browserResult.refreshToken}`),
        response as Response,
      ),
    ).rejects.toThrow('Refresh rejected');

    expect(response.clearCookie).toHaveBeenCalledWith(
      '__Host-posv2-portal-refresh',
      expect.objectContaining({ secure: true, httpOnly: true, path: '/' }),
    );
  });

  it('keeps the newly rotated cookie available during a concurrent refresh', async () => {
    portal.refresh.mockRejectedValue(
      new ConflictException({
        code: 'PORTAL_REFRESH_ALREADY_ROTATED',
        message: 'Refresh already completed.',
      }),
    );

    await expect(
      controller.refreshWeb(
        request(`__Host-posv2-portal-refresh=${browserResult.refreshToken}`),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('revokes the server session and clears the refresh cookie on logout', async () => {
    portal.logout.mockResolvedValue(undefined);

    await controller.logoutWeb(
      request(`__Host-posv2-portal-refresh=${browserResult.refreshToken}`),
      response as Response,
    );

    expect(portal.logout).toHaveBeenCalledWith(browserResult.refreshToken);
    expect(response.clearCookie).toHaveBeenCalledWith(
      '__Host-posv2-portal-refresh',
      expect.objectContaining({ secure: true, httpOnly: true, path: '/' }),
    );
  });
});

function request(
  cookie?: string,
  options: { csrf?: boolean; origin?: string } = {},
): Request {
  const headers: Record<string, string | undefined> = {
    'x-posv2-csrf': options.csrf === false ? undefined : '1',
    origin: options.origin ?? 'https://vmjamdocuai.cloud',
    cookie,
    'user-agent': 'Test browser',
  };
  return {
    ip: '203.0.113.10',
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}
