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
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshSessionRecord> {
    return this.prisma.refreshSession.create({ data: input });
  }

  findRefreshSession(id: string): Promise<RefreshSessionRecord | null> {
    return this.prisma.refreshSession.findUnique({ where: { id } });
  }

  async revokeRefreshSession(id: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
