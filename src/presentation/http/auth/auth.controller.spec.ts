import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { jest } from '@jest/globals';
import type { AuthService } from '../../../application/auth/auth.service.js';
import { AuthController } from './auth.controller.js';

const browserResult = {
  accessToken: 'access-token',
  refreshToken: 'session-id.refresh-secret',
  browserSession: true,
  persistent: true,
  user: {
    id: 'user-id',
    username: 'administrator',
    displayName: 'Subscription Admin',
    role: 'SUPER_ADMIN' as const,
  },
};

describe('AuthController browser sessions', () => {
  const auth = {
    loginWeb: jest.fn(),
    refreshWeb: jest.fn(),
    logout: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'ADMIN_WEB_ORIGINS') return 'https://admin.vmjamdocuai.cloud';
      if (key === 'NODE_ENV') return 'production';
      if (key === 'ADMIN_REMEMBER_LOGIN_TTL_DAYS') return 30;
      return fallback;
    }),
  };
  let controller: AuthController;
  let response: Pick<Response, 'cookie' | 'clearCookie'>;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(
      auth as unknown as AuthService,
      config as unknown as ConfigService,
    );
    response = {
      cookie: jest.fn() as unknown as Response['cookie'],
      clearCookie: jest.fn() as unknown as Response['clearCookie'],
    };
  });

  it('uses a persistent host-only cookie and omits the refresh token from JSON', async () => {
    auth.loginWeb.mockResolvedValue(browserResult);

    const result = await controller.loginWeb(
      {
        username: 'administrator',
        password: 'StrongPassword123!',
        rememberMe: true,
      },
      request(),
      response as Response,
    );

    expect(auth.loginWeb).toHaveBeenCalledWith(
      'administrator',
      'StrongPassword123!',
      true,
    );
    expect(result).toEqual({
      accessToken: browserResult.accessToken,
      user: browserResult.user,
    });
    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-posv2-admin-refresh',
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

  it('omits Max-Age for a browser-session login', async () => {
    auth.loginWeb.mockResolvedValue({ ...browserResult, persistent: false });

    await controller.loginWeb(
      {
        username: 'administrator',
        password: 'StrongPassword123!',
        rememberMe: false,
      },
      request(),
      response as Response,
    );

    const options = (response.cookie as jest.Mock).mock.calls[0]?.[2];
    expect(options).not.toHaveProperty('maxAge');
  });

  it('reads and rotates the browser credential from its cookie', async () => {
    auth.refreshWeb.mockResolvedValue(browserResult);

    await controller.refreshWeb(
      request(`__Host-posv2-admin-refresh=${browserResult.refreshToken}`),
      response as Response,
    );

    expect(auth.refreshWeb).toHaveBeenCalledWith(browserResult.refreshToken);
    expect(response.cookie).toHaveBeenCalled();
  });

  it('rejects a missing CSRF header or an untrusted origin', async () => {
    await expect(
      controller.loginWeb(
        {
          username: 'administrator',
          password: 'StrongPassword123!',
          rememberMe: false,
        },
        request(undefined, { csrf: false }),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.loginWeb(
        {
          username: 'administrator',
          password: 'StrongPassword123!',
          rememberMe: false,
        },
        request(undefined, { origin: 'https://attacker.example' }),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not clear a cookie during a concurrent rotation conflict', async () => {
    auth.refreshWeb.mockRejectedValue(
      new ConflictException({ code: 'ADMIN_REFRESH_ALREADY_ROTATED' }),
    );

    await expect(
      controller.refreshWeb(
        request(`__Host-posv2-admin-refresh=${browserResult.refreshToken}`),
        response as Response,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('revokes the session and clears the cookie on logout', async () => {
    auth.logout.mockResolvedValue(undefined);

    await controller.logoutWeb(
      request(`__Host-posv2-admin-refresh=${browserResult.refreshToken}`),
      response as Response,
    );

    expect(auth.logout).toHaveBeenCalledWith(browserResult.refreshToken);
    expect(response.clearCookie).toHaveBeenCalledWith(
      '__Host-posv2-admin-refresh',
      expect.objectContaining({ httpOnly: true, secure: true, path: '/' }),
    );
  });
});

function request(
  cookie?: string,
  options: { csrf?: boolean; origin?: string } = {},
): Request {
  const headers: Record<string, string | undefined> = {
    'x-posv2-csrf': options.csrf === false ? undefined : '1',
    origin: options.origin ?? 'https://admin.vmjamdocuai.cloud',
    cookie,
  };
  return {
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}
