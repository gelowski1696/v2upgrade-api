import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
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

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(username: string, password: string): Promise<AuthResult> {
    const user = await this.users.findByUsername(username.trim().toLowerCase());
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !(await this.hasher.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException('Invalid username or password.');
    }

    await this.users.markLogin(user.id);
    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const [sessionId, secret] = refreshToken.split('.', 2);
    if (!sessionId || !secret) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const session = await this.users.findRefreshSession(sessionId);
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !(await this.hasher.verify(session.tokenHash, secret))
    ) {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is unavailable.');
    }

    await this.users.revokeRefreshSession(session.id);
    return this.issueSession(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const [sessionId] = refreshToken.split('.', 1);
    if (sessionId) {
      await this.users.revokeRefreshSession(sessionId);
    }
  }

  private async issueSession(user: UserAccount): Promise<AuthResult> {
    const secret = randomBytes(48).toString('base64url');
    const refreshDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30);
    const expiresAt = new Date(Date.now() + refreshDays * 86_400_000);
    const session = await this.users.createRefreshSession({
      userId: user.id,
      tokenHash: await this.hasher.hash(secret),
      expiresAt,
    });
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
      refreshToken: `${session.id}.${secret}`,
      user: this.toAuthenticatedUser(user),
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
