import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SignOptions } from 'jsonwebtoken';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import { webDashboardEnabled } from '../../domain/subscriptions/feature-mods.js';
import type {
  AuthenticatedPortalUser,
  PortalRole,
} from '../../domain/portal/portal-auth.types.js';
import { Argon2PasswordHasher } from '../../infrastructure/auth/argon2-password-hasher.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface PortalRequestContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: Argon2PasswordHasher,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async createInvitation(
    device: AuthenticatedDevice,
    input: { username: string; displayName: string; role: PortalRole },
  ) {
    const username = this.normalizeUsername(input.username);
    const existing = await this.prisma.portalUser.findUnique({
      where: { username },
    });
    if (existing) {
      throw new ConflictException(
        'A portal account already uses this username.',
      );
    }
    const pending = await this.prisma.portalInvitation.findFirst({
      where: {
        storeId: device.storeId,
        username,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException(
        'An active invitation already exists for this username.',
      );
    }
    const token = randomBytes(32).toString('base64url');
    const invitation = await this.prisma.portalInvitation.create({
      data: {
        clientId: device.clientId,
        storeId: device.storeId,
        username,
        displayName: input.displayName.trim(),
        role: input.role,
        tokenHash: this.tokenHash(token),
        expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
        createdByDeviceId: device.id,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.invitation_created',
        resourceType: 'portal_invitation',
        resourceId: invitation.id,
        metadata: { deviceId: device.id, storeId: device.storeId, username },
      },
    });
    return {
      id: invitation.id,
      username,
      displayName: invitation.displayName,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      activationToken: token,
    };
  }

  async revokeInvitation(device: AuthenticatedDevice, invitationId: string) {
    const result = await this.prisma.portalInvitation.updateMany({
      where: {
        id: invitationId,
        storeId: device.storeId,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Invitation was not found.');
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.invitation_revoked',
        resourceType: 'portal_invitation',
        resourceId: invitationId,
        metadata: { deviceId: device.id, storeId: device.storeId },
      },
    });
  }

  async listUsers(device: AuthenticatedDevice) {
    const users = await this.prisma.portalUser.findMany({
      where: { storeAccess: { some: { storeId: device.storeId } } },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { displayName: 'asc' },
    });
    const invitations = await this.prisma.portalInvitation.findMany({
      where: {
        storeId: device.storeId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { users, invitations };
  }

  async setUserStatus(
    device: AuthenticatedDevice,
    userId: string,
    enabled: boolean,
  ) {
    const access = await this.prisma.portalStoreAccess.findUnique({
      where: {
        portalUserId_storeId: { portalUserId: userId, storeId: device.storeId },
      },
    });
    if (!access) throw new NotFoundException('Portal user was not found.');
    await this.prisma.$transaction([
      this.prisma.portalUser.update({
        where: { id: userId },
        data: { status: enabled ? 'ACTIVE' : 'DISABLED' },
      }),
      ...(enabled
        ? []
        : [
            this.prisma.portalRefreshSession.updateMany({
              where: { portalUserId: userId, revokedAt: null },
              data: {
                revokedAt: new Date(),
                revokedReason: 'ACCOUNT_DISABLED',
              },
            }),
          ]),
    ]);
    await this.prisma.auditLog.create({
      data: {
        action: enabled ? 'portal.user_enabled' : 'portal.user_disabled',
        resourceType: 'portal_user',
        resourceId: userId,
        metadata: { deviceId: device.id, storeId: device.storeId },
      },
    });
  }

  async activate(
    token: string,
    password: string,
    context: PortalRequestContext = {},
  ) {
    const invitation = await this.prisma.portalInvitation.findUnique({
      where: { tokenHash: this.tokenHash(token) },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Activation link is invalid or expired.');
    }
    if (
      !(await this.enabledWebDashboardStoreIds([invitation.storeId])).length
    ) {
      throw new UnauthorizedException('Web dashboard access is not enabled.');
    }
    const passwordHash = await this.hasher.hash(password);
    const user = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.portalInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (!claimed.count) {
        throw new UnauthorizedException(
          'Activation link is invalid or expired.',
        );
      }
      const created = await transaction.portalUser.create({
        data: {
          clientId: invitation.clientId,
          username: invitation.username,
          displayName: invitation.displayName,
          passwordHash,
          role: invitation.role,
          status: 'ACTIVE',
          passwordChangedAt: new Date(),
          storeAccess: { create: { storeId: invitation.storeId } },
        },
        include: { storeAccess: true },
      });
      await transaction.auditLog.create({
        data: {
          action: 'portal.account_activated',
          resourceType: 'portal_user',
          resourceId: created.id,
          metadata: {
            storeId: invitation.storeId,
            invitationId: invitation.id,
          },
        },
      });
      return created;
    });
    return this.issueSession(
      {
        id: user.id,
        sessionId: '',
        clientId: user.clientId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        storeIds: user.storeAccess.map((access) => access.storeId),
      },
      context,
    );
  }

  async login(
    username: string,
    password: string,
    context: PortalRequestContext = {},
  ) {
    const user = await this.prisma.portalUser.findUnique({
      where: { username: this.normalizeUsername(username) },
      include: { storeAccess: true },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !(await this.hasher.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    await this.prisma.portalUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const result = await this.issueSession(
      {
        id: user.id,
        sessionId: '',
        clientId: user.clientId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        storeIds: user.storeAccess.map((access) => access.storeId),
      },
      context,
    );
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.login_succeeded',
        resourceType: 'portal_user',
        resourceId: user.id,
        metadata: {
          portalUserId: user.id,
          clientId: user.clientId,
          deviceName: this.describeUserAgent(context.userAgent ?? null),
        },
      },
    });
    return result;
  }

  async refresh(refreshToken: string, context: PortalRequestContext = {}) {
    const [id, secret] = refreshToken.split('.', 2);
    if (!id || !secret)
      throw new UnauthorizedException('Invalid refresh token.');
    const session = await this.prisma.portalRefreshSession.findUnique({
      where: { id },
      include: { user: { include: { storeAccess: true } } },
    });
    if (!session) {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    const secretMatches = await this.hasher.verify(session.tokenHash, secret);
    if (!secretMatches) {
      await this.auditRefreshFailure(session, 'SECRET_MISMATCH', context);
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    if (session.revokedAt) {
      if (this.isRecentRotation(session)) {
        await this.auditRefreshFailure(session, 'CONCURRENT_ROTATION', context);
        throw this.concurrentRefreshException();
      }
      await this.revokeRefreshFamilyForReplay(session, context);
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    if (session.expiresAt <= new Date()) {
      await this.auditRefreshFailure(session, 'EXPIRED', context);
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    if (session.user.status !== 'ACTIVE') {
      await this.auditRefreshFailure(session, 'USER_INACTIVE', context);
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    const portalUser: AuthenticatedPortalUser = {
      id: session.user.id,
      sessionId: '',
      clientId: session.user.clientId,
      username: session.user.username,
      displayName: session.user.displayName,
      role: session.user.role,
      storeIds: session.user.storeAccess.map((access) => access.storeId),
    };
    const storeIds = await this.enabledWebDashboardStoreIds(
      portalUser.storeIds,
    );
    if (!storeIds.length) {
      await this.auditRefreshFailure(session, 'ACCESS_DISABLED', context);
      throw new UnauthorizedException('Web dashboard access is not enabled.');
    }

    const now = new Date();
    const replacementId = randomUUID();
    const replacementSecret = randomBytes(48).toString('base64url');
    const replacementHash = await this.hasher.hash(replacementSecret);
    const days = this.config.get<number>('PORTAL_REFRESH_TOKEN_TTL_DAYS', 30);
    const replacement = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.portalRefreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: {
          revokedAt: now,
          revokedReason: 'ROTATED',
          lastUsedAt: now,
        },
      });
      if (!claimed.count) return null;

      const created = await transaction.portalRefreshSession.create({
        data: {
          id: replacementId,
          portalUserId: session.portalUserId,
          tokenHash: replacementHash,
          tokenFamilyId: session.tokenFamilyId,
          userAgent: context.userAgent?.slice(0, 500),
          ipAddress: context.ipAddress?.slice(0, 80),
          expiresAt: new Date(now.getTime() + days * 86_400_000),
        },
      });
      await transaction.portalRefreshSession.update({
        where: { id: session.id },
        data: { replacedBySessionId: created.id },
      });
      return created;
    });

    if (!replacement) {
      const latest = await this.prisma.portalRefreshSession.findUnique({
        where: { id: session.id },
        select: {
          id: true,
          portalUserId: true,
          tokenFamilyId: true,
          replacedBySessionId: true,
          revokedReason: true,
          lastUsedAt: true,
        },
      });
      if (latest && this.isRecentRotation(latest)) {
        await this.auditRefreshFailure(latest, 'CONCURRENT_ROTATION', context);
        throw this.concurrentRefreshException();
      }
      await this.revokeRefreshFamilyForReplay(latest ?? session, context);
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    return this.sessionResult(
      portalUser,
      storeIds,
      replacement.id,
      replacementSecret,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const [id] = refreshToken.split('.', 1);
    if (id) {
      const session = await this.prisma.portalRefreshSession.findUnique({
        where: { id },
        select: { portalUserId: true, userAgent: true },
      });
      await this.prisma.portalRefreshSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      if (session) {
        await this.prisma.auditLog.create({
          data: {
            action: 'portal.logged_out',
            resourceType: 'portal_user',
            resourceId: session.portalUserId,
            metadata: {
              portalUserId: session.portalUserId,
              deviceName: this.describeUserAgent(session.userAgent),
            },
          },
        });
      }
    }
  }

  async changePassword(
    user: AuthenticatedPortalUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const account = await this.prisma.portalUser.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, status: true },
    });
    if (
      !account ||
      account.status !== 'ACTIVE' ||
      !(await this.hasher.verify(account.passwordHash, currentPassword))
    ) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    if (await this.hasher.verify(account.passwordHash, newPassword)) {
      throw new ConflictException('New password must be different.');
    }
    const now = new Date();
    const passwordHash = await this.hasher.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.portalUser.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.portalRefreshSession.updateMany({
        where: { portalUserId: user.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_CHANGED' },
      }),
      this.prisma.auditLog.create({
        data: {
          action: 'portal.password_changed',
          resourceType: 'portal_user',
          resourceId: user.id,
          metadata: { sessionId: user.sessionId },
        },
      }),
    ]);
  }

  async createPasswordReset(device: AuthenticatedDevice, userId: string) {
    const access = await this.prisma.portalStoreAccess.findUnique({
      where: {
        portalUserId_storeId: {
          portalUserId: userId,
          storeId: device.storeId,
        },
      },
      include: { user: { select: { username: true } } },
    });
    if (!access) throw new NotFoundException('Portal user was not found.');

    const token = randomBytes(32).toString('base64url');
    const ttlMinutes = this.config.get<number>(
      'PORTAL_PASSWORD_RESET_TTL_MINUTES',
      60,
    );
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const now = new Date();
    const reset = await this.prisma.$transaction(async (transaction) => {
      await transaction.portalPasswordReset.updateMany({
        where: {
          portalUserId: userId,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      const created = await transaction.portalPasswordReset.create({
        data: {
          portalUserId: userId,
          tokenHash: this.tokenHash(token),
          expiresAt,
          createdByDeviceId: device.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'portal.password_reset_created',
          resourceType: 'portal_user',
          resourceId: userId,
          metadata: { deviceId: device.id, storeId: device.storeId },
        },
      });
      return created;
    });
    return {
      id: reset.id,
      username: access.user.username,
      expiresAt: reset.expiresAt,
      resetToken: token,
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const reset = await this.prisma.portalPasswordReset.findUnique({
      where: { tokenHash: this.tokenHash(token) },
      include: { user: { select: { passwordHash: true } } },
    });
    if (
      !reset ||
      reset.usedAt ||
      reset.revokedAt ||
      reset.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(
        'Password reset token is invalid or expired.',
      );
    }
    if (await this.hasher.verify(reset.user.passwordHash, newPassword)) {
      throw new ConflictException('New password must be different.');
    }
    const now = new Date();
    const passwordHash = await this.hasher.hash(newPassword);
    await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.portalPasswordReset.updateMany({
        where: {
          id: reset.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (!claimed.count) {
        throw new UnauthorizedException(
          'Password reset token is invalid or expired.',
        );
      }
      await transaction.portalUser.update({
        where: { id: reset.portalUserId },
        data: { passwordHash, passwordChangedAt: now },
      });
      await transaction.portalRefreshSession.updateMany({
        where: { portalUserId: reset.portalUserId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
      });
      await transaction.auditLog.create({
        data: {
          action: 'portal.password_reset_completed',
          resourceType: 'portal_user',
          resourceId: reset.portalUserId,
          metadata: { resetId: reset.id },
        },
      });
    });
  }

  async listSessions(user: AuthenticatedPortalUser) {
    const sessions = await this.prisma.portalRefreshSession.findMany({
      where: {
        portalUserId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.id === user.sessionId,
      deviceName: this.describeUserAgent(session.userAgent),
    }));
  }

  async revokeSession(
    user: AuthenticatedPortalUser,
    sessionId: string,
  ): Promise<void> {
    const revokedAt = new Date();
    const result = await this.prisma.portalRefreshSession.updateMany({
      where: { id: sessionId, portalUserId: user.id, revokedAt: null },
      data: { revokedAt, revokedReason: 'USER_REVOKED' },
    });
    if (!result.count) throw new NotFoundException('Session was not found.');
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.session_revoked',
        resourceType: 'portal_refresh_session',
        resourceId: sessionId,
        metadata: { portalUserId: user.id, revokedBySessionId: user.sessionId },
      },
    });
  }

  async revokeOtherSessions(user: AuthenticatedPortalUser): Promise<void> {
    const now = new Date();
    const result = await this.prisma.portalRefreshSession.updateMany({
      where: {
        portalUserId: user.id,
        id: { not: user.sessionId },
        revokedAt: null,
      },
      data: { revokedAt: now, revokedReason: 'OTHER_SESSIONS_REVOKED' },
    });
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.other_sessions_revoked',
        resourceType: 'portal_user',
        resourceId: user.id,
        metadata: { currentSessionId: user.sessionId, count: result.count },
      },
    });
  }

  private async issueSession(
    user: AuthenticatedPortalUser,
    context: PortalRequestContext,
  ) {
    const storeIds = await this.enabledWebDashboardStoreIds(user.storeIds);
    if (!storeIds.length) {
      throw new UnauthorizedException('Web dashboard access is not enabled.');
    }
    const secret = randomBytes(48).toString('base64url');
    const refreshId = randomUUID();
    const days = this.config.get<number>('PORTAL_REFRESH_TOKEN_TTL_DAYS', 30);
    const refresh = await this.prisma.portalRefreshSession.create({
      data: {
        id: refreshId,
        portalUserId: user.id,
        tokenHash: await this.hasher.hash(secret),
        tokenFamilyId: refreshId,
        userAgent: context.userAgent?.slice(0, 500),
        ipAddress: context.ipAddress?.slice(0, 80),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    return this.sessionResult(user, storeIds, refresh.id, secret);
  }

  private async sessionResult(
    user: AuthenticatedPortalUser,
    storeIds: string[],
    refreshId: string,
    refreshSecret: string,
  ) {
    const authenticatedUser = { ...user, storeIds, sessionId: refreshId };
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        clientId: user.clientId,
        sessionId: refreshId,
        tokenUse: 'portal',
      },
      {
        secret: this.config.getOrThrow<string>('PORTAL_JWT_ACCESS_SECRET'),
        audience: 'posv2-owner-portal',
        issuer: 'posv2-subscriptions',
        expiresIn: this.config.get<string>(
          'PORTAL_ACCESS_TOKEN_TTL',
          '15m',
        ) as SignOptions['expiresIn'],
      },
    );
    return {
      accessToken,
      refreshToken: `${refreshId}.${refreshSecret}`,
      user: authenticatedUser,
    };
  }

  private async auditRefreshFailure(
    session: {
      id: string;
      portalUserId: string;
      tokenFamilyId: string;
    },
    reason: string,
    context: PortalRequestContext,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: 'portal.refresh_failed',
        resourceType: 'portal_refresh_session',
        resourceId: session.id,
        metadata: {
          portalUserId: session.portalUserId,
          tokenFamilyId: session.tokenFamilyId,
          reason,
          deviceName: this.describeUserAgent(context.userAgent ?? null),
        },
      },
    });
  }

  private async revokeRefreshFamilyForReplay(
    session: {
      id: string;
      portalUserId: string;
      tokenFamilyId: string;
    },
    context: PortalRequestContext,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.portalRefreshSession.updateMany({
        where: { tokenFamilyId: session.tokenFamilyId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'REPLAY_DETECTED' },
      });
      await transaction.auditLog.create({
        data: {
          action: 'portal.refresh_replay_detected',
          resourceType: 'portal_refresh_session',
          resourceId: session.id,
          metadata: {
            portalUserId: session.portalUserId,
            tokenFamilyId: session.tokenFamilyId,
            revokedSessionCount: revoked.count,
            deviceName: this.describeUserAgent(context.userAgent ?? null),
          },
        },
      });
    });
  }

  private isRecentRotation(session: {
    revokedReason: string | null;
    replacedBySessionId: string | null;
    lastUsedAt: Date;
  }): boolean {
    if (session.revokedReason !== 'ROTATED' || !session.replacedBySessionId) {
      return false;
    }
    const graceSeconds = this.config.get<number>(
      'PORTAL_REFRESH_REUSE_GRACE_SECONDS',
      5,
    );
    return session.lastUsedAt.getTime() >= Date.now() - graceSeconds * 1_000;
  }

  private concurrentRefreshException(): ConflictException {
    return new ConflictException({
      code: 'PORTAL_REFRESH_ALREADY_ROTATED',
      message: 'The browser session was refreshed by another request.',
    });
  }

  private async enabledWebDashboardStoreIds(
    storeIds: string[],
  ): Promise<string[]> {
    if (!storeIds.length) return [];
    const devices = await this.prisma.device.findMany({
      where: { storeId: { in: storeIds }, status: 'ACTIVE' },
      select: {
        storeId: true,
        subscription: { select: { entitlements: true } },
      },
    });
    const disabledStores = new Set(
      devices
        .filter(
          (device) =>
            device.subscription &&
            !webDashboardEnabled(device.subscription.entitlements),
        )
        .map((device) => device.storeId),
    );
    return storeIds.filter((storeId) => !disabledStores.has(storeId));
  }

  private describeUserAgent(userAgent: string | null): string {
    if (!userAgent) return 'Unknown browser';
    const browser = userAgent.includes('Edg/')
      ? 'Microsoft Edge'
      : userAgent.includes('Chrome/')
        ? 'Google Chrome'
        : userAgent.includes('Firefox/')
          ? 'Mozilla Firefox'
          : userAgent.includes('Safari/')
            ? 'Safari'
            : 'Browser';
    const platform = userAgent.includes('Windows')
      ? 'Windows'
      : userAgent.includes('Android')
        ? 'Android'
        : userAgent.includes('iPhone') || userAgent.includes('iPad')
          ? 'iOS'
          : userAgent.includes('Macintosh')
            ? 'macOS'
            : '';
    return platform ? `${browser} on ${platform}` : browser;
  }

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
