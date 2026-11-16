import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { PrismaService } from '../database/prisma.service.js';
import { PortalJwtStrategy } from './portal-jwt.strategy.js';

describe('PortalJwtStrategy subscription access', () => {
  const prisma = {
    portalRefreshSession: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    store: { findMany: jest.fn() },
    device: { findMany: jest.fn() },
  };
  const config = {
    getOrThrow: jest.fn(() => 'portal-secret-with-at-least-32-characters'),
  };
  let strategy: PortalJwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new PortalJwtStrategy(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
    prisma.portalRefreshSession.findFirst.mockResolvedValue({
      id: 'session-one',
      lastUsedAt: new Date(),
      user: {
        id: 'portal-user',
        clientId: 'client-one',
        username: 'owner@example.test',
        displayName: 'Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        client: { status: 'ACTIVE' },
        storeAccess: [{ storeId: 'store-one' }],
      },
    });
  });

  it('rejects an existing access token after the store subscription is suspended', async () => {
    prisma.store.findMany.mockResolvedValue([
      {
        id: 'store-one',
        client: {
          subscriptions: [
            { status: 'SUSPENDED', entitlements: { webDashboard: true } },
          ],
        },
      },
    ]);

    await expect(
      strategy.validate({
        sub: 'portal-user',
        clientId: 'client-one',
        sessionId: 'session-one',
        tokenUse: 'portal',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows an authorized owner before a desktop device is enrolled', async () => {
    prisma.store.findMany.mockResolvedValue([
      {
        id: 'store-one',
        client: {
          subscriptions: [
            { status: 'ACTIVE', entitlements: { webDashboard: true } },
          ],
        },
      },
    ]);

    const user = await strategy.validate({
      sub: 'portal-user',
      clientId: 'client-one',
      sessionId: 'session-one',
      tokenUse: 'portal',
    });

    expect(user.storeIds).toEqual(['store-one']);
    expect(prisma.device.findMany).not.toHaveBeenCalled();
  });

  it('removes suspended stores while preserving subscribed group access', async () => {
    prisma.portalRefreshSession.findFirst.mockResolvedValue({
      id: 'session-one',
      lastUsedAt: new Date(),
      user: {
        id: 'portal-user',
        clientId: 'client-one',
        username: 'owner@example.test',
        displayName: 'Owner',
        role: 'OWNER',
        status: 'ACTIVE',
        client: { status: 'ACTIVE' },
        storeAccess: [{ storeId: 'store-one' }, { storeId: 'store-two' }],
      },
    });
    prisma.store.findMany.mockResolvedValue([
      {
        id: 'store-one',
        client: {
          subscriptions: [
            { status: 'SUSPENDED', entitlements: { webDashboard: true } },
          ],
        },
      },
      {
        id: 'store-two',
        client: {
          subscriptions: [
            { status: 'ACTIVE', entitlements: { webDashboard: true } },
          ],
        },
      },
    ]);

    const user = await strategy.validate({
      sub: 'portal-user',
      clientId: 'client-one',
      sessionId: 'session-one',
      tokenUse: 'portal',
    });

    expect(user.storeIds).toEqual(['store-two']);
  });
});
