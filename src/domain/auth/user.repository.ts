import type { RefreshSessionRecord, UserAccount } from './auth.types.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByUsername(username: string): Promise<UserAccount | null>;
  findById(id: string): Promise<UserAccount | null>;
  markLogin(id: string): Promise<void>;
  createRefreshSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshSessionRecord>;
  findRefreshSession(id: string): Promise<RefreshSessionRecord | null>;
  revokeRefreshSession(id: string): Promise<void>;
}
