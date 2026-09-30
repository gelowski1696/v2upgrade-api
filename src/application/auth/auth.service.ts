import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'node:crypto';
import type { SignOptions } from 'jsonwebtoken';
import type {
  AuthenticatedUser,
  UserAccount,
} from '../../domain/auth/auth.types.js';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../domain/auth/password-hasher.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../domain/auth/user.repository.js';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

export interface BrowserAuthResult extends AuthResult {
  browserSession: boolean;
  persistent: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(username: string, password: string): Promise<AuthResult> {
    const user = await this.authenticate(username, password);
    return this.publicResult(
      await this.issueSession(user, {
        browserSession: false,
        persistent: false,
        ttlMilliseconds:
          this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30) * 86_400_000,
      }),
    );
  }

  async loginWeb(
    username: string,
    password: string,
    rememberMe: boolean,
  ): Promise<BrowserAuthResult> {
    const user = await this.authenticate(username, password);
    const persistent =
      this.config.get<boolean>('WEB_REMEMBER_LOGIN_ENABLED', true) &&
      rememberMe;
    return this.issueSession(user, {
      browserSession: true,
      persistent,
      ttlMilliseconds: persistent
        ? this.config.get<number>('ADMIN_REMEMBER_LOGIN_TTL_DAYS', 30) *
          86_400_000
        : this.config.get<number>('ADMIN_BROWSER_SESSION_TTL_HOURS', 24) *
          3_600_000,
    });
  }

  private async authenticate(
    username: string,
    password: string,
  ): Promise<UserAccount> {
    const user = await this.users.findByUsername(username.trim().toLowerCase());
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !(await this.hasher.verify(user.passwordHash, password))
    ) {
      this.logger.warn(
        JSON.stringify({
          event: 'admin.login_failed',
          reason: 'INVALID_CREDENTIALS',
        }),
      );
      throw new UnauthorizedException('Invalid username or password.');
    }

    await this.users.markLogin(user.id);
    return user;
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    return this.publicResult(await this.rotateSession(refreshToken));
  }

  async refreshWeb(refreshToken: string): Promise<BrowserAuthResult> {
    const result = await this.rotateSession(refreshToken);
    if (!result.browserSession) {
      await this.users.revokeRefreshSession(
        result.refreshToken.split('.', 1)[0] ?? '',
        'CHANNEL_MISMATCH',
      );
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    return result;
  }

  private async rotateSession(
    refreshToken: string,
  ): Promise<BrowserAuthResult> {
    const [sessionId, secret] = refreshToken.split('.', 2);
    if (!sessionId || !secret) {
      this.logRefreshFailure('MALFORMED_TOKEN');
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const session = await this.users.findRefreshSession(sessionId);
    if (!session || !(await this.hasher.verify(session.tokenHash, secret))) {
      this.logRefreshFailure('INVALID_OR_EXPIRED');
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    if (session.revokedAt) {
      if (this.isRecentRotation(session)) {
        throw new ConflictException({
          code: 'ADMIN_REFRESH_ALREADY_ROTATED',
          message: 'Refresh already completed.',
        });
      }
      const revokedCount = await this.users.revokeRefreshFamily(
        session.tokenFamilyId,
        'REPLAY_DETECTED',
      );
      this.logger.warn(
        JSON.stringify({
          event: 'admin.refresh_replay_detected',
          userId: session.userId,
          revokedSessionCount: revokedCount,
        }),
      );
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    if (session.expiresAt <= new Date()) {
      await this.users.revokeRefreshSession(session.id, 'EXPIRED');
      this.logRefreshFailure('INVALID_OR_EXPIRED');
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      this.logRefreshFailure('ACCOUNT_UNAVAILABLE');
      throw new UnauthorizedException('Account is unavailable.');
    }

    const now = new Date();
    const replacementId = randomUUID();
    const replacementSecret = randomBytes(48).toString('base64url');
    const ttlMilliseconds = this.refreshTtlMilliseconds(session);
    const replacement = await this.users.rotateRefreshSession({
      currentId: session.id,
      replacementId,
      userId: user.id,
      tokenHash: await this.hasher.hash(replacementSecret),
      tokenFamilyId: session.tokenFamilyId,
      browserSession: session.browserSession,
      persistent: session.persistent,
      expiresAt: new Date(now.getTime() + ttlMilliseconds),
      now,
    });
    if (!replacement) {
      const latest = await this.users.findRefreshSession(session.id);
      if (latest && this.isRecentRotation(latest)) {
        throw new ConflictException({
          code: 'ADMIN_REFRESH_ALREADY_ROTATED',
          message: 'Refresh already completed.',
        });
      }
      await this.users.revokeRefreshFamily(
        session.tokenFamilyId,
        'REPLAY_DETECTED',
      );
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
    return this.sessionResult(
      user,
      replacement.id,
      replacementSecret,
      replacement.browserSession,
      replacement.persistent,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const [sessionId] = refreshToken.split('.', 1);
    if (sessionId) {
      await this.users.revokeRefreshSession(sessionId, 'LOGOUT');
    }
  }

  private async issueSession(
    user: UserAccount,
    options: {
      browserSession: boolean;
      persistent: boolean;
      ttlMilliseconds: number;
    },
  ): Promise<BrowserAuthResult> {
    const secret = randomBytes(48).toString('base64url');
    const refreshId = randomUUID();
    const expiresAt = new Date(Date.now() + options.ttlMilliseconds);
    const session = await this.users.createRefreshSession({
      id: refreshId,
      userId: user.id,
      tokenHash: await this.hasher.hash(secret),
      tokenFamilyId: refreshId,
      browserSession: options.browserSession,
      persistent: options.persistent,
      expiresAt,
    });
    return this.sessionResult(
      user,
      session.id,
      secret,
      session.browserSession,
      session.persistent,
    );
  }

  private async sessionResult(
    user: UserAccount,
    refreshId: string,
    refreshSecret: string,
    browserSession: boolean,
    persistent: boolean,
  ): Promise<BrowserAuthResult> {
    const accessTtl = this.config.get<string>('ACCESS_TOKEN_TTL', '15m');
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl as SignOptions['expiresIn'],
      },
    );

    return {
      accessToken,
      refreshToken: `${refreshId}.${refreshSecret}`,
      user: this.toAuthenticatedUser(user),
      browserSession,
      persistent,
    };
  }

  private refreshTtlMilliseconds(session: {
    browserSession: boolean;
    persistent: boolean;
  }): number {
    if (!session.browserSession) {
      return this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30) * 86_400_000;
    }
    return session.persistent
      ? this.config.get<number>('ADMIN_REMEMBER_LOGIN_TTL_DAYS', 30) *
          86_400_000
      : this.config.get<number>('ADMIN_BROWSER_SESSION_TTL_HOURS', 24) *
          3_600_000;
  }

  private isRecentRotation(session: {
    revokedReason: string | null;
    lastUsedAt: Date;
  }): boolean {
    const graceSeconds = this.config.get<number>(
      'ADMIN_REFRESH_REUSE_GRACE_SECONDS',
      5,
    );
    return (
      session.revokedReason === 'ROTATED' &&
      Date.now() - session.lastUsedAt.getTime() <= graceSeconds * 1000
    );
  }

  private logRefreshFailure(reason: string): void {
    this.logger.warn(JSON.stringify({ event: 'admin.refresh_failed', reason }));
  }

  private publicResult(result: BrowserAuthResult): AuthResult {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };
  }

  private toAuthenticatedUser(user: UserAccount): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
