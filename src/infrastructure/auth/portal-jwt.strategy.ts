import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { webDashboardEnabled } from '../../domain/subscriptions/feature-mods.js';
import { PrismaService } from '../database/prisma.service.js';

interface PortalTokenPayload {
  sub: string;
  clientId: string;
  sessionId: string;
  tokenUse: 'portal';
}

@Injectable()
export class PortalJwtStrategy extends PassportStrategy(
  Strategy,
  'portal-jwt',
) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('PORTAL_JWT_ACCESS_SECRET'),
      audience: 'posv2-owner-portal',
      issuer: 'posv2-subscriptions',
    });
  }

  async validate(
    payload: PortalTokenPayload,
  ): Promise<AuthenticatedPortalUser> {
    if (payload.tokenUse !== 'portal') {
      throw new UnauthorizedException('Invalid portal session.');
    }
    if (!payload.sessionId) {
      throw new UnauthorizedException('Invalid portal session.');
    }
    const session = await this.prisma.portalRefreshSession.findFirst({
      where: {
        id: payload.sessionId,
        portalUserId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            client: { select: { status: true } },
            storeAccess: {
              where: {
                store: { status: 'ACTIVE', client: { status: 'ACTIVE' } },
              },
              select: { storeId: true },
            },
          },
        },
      },
    });
    if (
      !session ||
      session.user.status !== 'ACTIVE' ||
      session.user.client.status !== 'ACTIVE' ||
      session.user.clientId !== payload.clientId
    ) {
      throw new UnauthorizedException('Portal account is unavailable.');
    }
    const storeIds = session.user.storeAccess.map((access) => access.storeId);
    const stores = await this.prisma.store.findMany({
      where: {
        id: { in: storeIds },
        status: 'ACTIVE',
        client: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        client: {
          select: {
            subscriptions: {
              where: { deletedAt: null },
              select: { status: true, entitlements: true },
            },
          },
        },
      },
    });
    const subscribedStores = new Set(
      stores
        .filter((store) =>
          store.client.subscriptions.some(
            (subscription) =>
              ['ACTIVE', 'TRIAL', 'GRACE'].includes(subscription.status) &&
              webDashboardEnabled(subscription.entitlements),
          ),
        )
        .map((store) => store.id),
    );
    const enabledStoreIds = storeIds.filter((storeId) =>
      subscribedStores.has(storeId),
    );
    if (!enabledStoreIds.length) {
      throw new UnauthorizedException('Web dashboard access is not enabled.');
    }
    if (session.lastUsedAt < new Date(Date.now() - 5 * 60_000)) {
      await this.prisma.portalRefreshSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      });
    }
    return {
      id: session.user.id,
      sessionId: session.id,
      clientId: session.user.clientId,
      username: session.user.username,
      displayName: session.user.displayName,
      role: session.user.role,
      storeIds: enabledStoreIds,
    };
  }
}
