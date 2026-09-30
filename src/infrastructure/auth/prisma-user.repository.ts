import { Injectable } from '@nestjs/common';
import type {
  RefreshSessionRecord,
  UserAccount,
} from '../../domain/auth/auth.types.js';
import type { UserRepository } from '../../domain/auth/user.repository.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUsername(username: string): Promise<UserAccount | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  async findById(id: string): Promise<UserAccount | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async markLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  createRefreshSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    tokenFamilyId: string;
    browserSession: boolean;
    persistent: boolean;
    expiresAt: Date;
  }): Promise<RefreshSessionRecord> {
    return this.prisma.refreshSession.create({ data: input });
  }

  findRefreshSession(id: string): Promise<RefreshSessionRecord | null> {
    return this.prisma.refreshSession.findUnique({ where: { id } });
  }

  async rotateRefreshSession(input: {
    currentId: string;
    replacementId: string;
    userId: string;
    tokenHash: string;
    tokenFamilyId: string;
    browserSession: boolean;
    persistent: boolean;
    expiresAt: Date;
    now: Date;
  }): Promise<RefreshSessionRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.refreshSession.updateMany({
        where: { id: input.currentId, revokedAt: null },
        data: {
          revokedAt: input.now,
          revokedReason: 'ROTATED',
          replacedBySessionId: input.replacementId,
          lastUsedAt: input.now,
        },
      });
      if (!claimed.count) return null;
      return transaction.refreshSession.create({
        data: {
          id: input.replacementId,
          userId: input.userId,
          tokenHash: input.tokenHash,
          tokenFamilyId: input.tokenFamilyId,
          browserSession: input.browserSession,
          persistent: input.persistent,
          expiresAt: input.expiresAt,
        },
      });
    });
  }

  async revokeRefreshSession(id: string, reason: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeRefreshFamily(
    tokenFamilyId: string,
    reason: string,
  ): Promise<number> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { tokenFamilyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }
}
