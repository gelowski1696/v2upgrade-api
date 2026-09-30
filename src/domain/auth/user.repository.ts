import type { RefreshSessionRecord, UserAccount } from './auth.types.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByUsername(username: string): Promise<UserAccount | null>;
  findById(id: string): Promise<UserAccount | null>;
  markLogin(id: string): Promise<void>;
  createRefreshSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    tokenFamilyId: string;
    browserSession: boolean;
    persistent: boolean;
    expiresAt: Date;
  }): Promise<RefreshSessionRecord>;
  findRefreshSession(id: string): Promise<RefreshSessionRecord | null>;
  rotateRefreshSession(input: {
    currentId: string;
    replacementId: string;
    userId: string;
    tokenHash: string;
    tokenFamilyId: string;
    browserSession: boolean;
    persistent: boolean;
    expiresAt: Date;
    now: Date;
  }): Promise<RefreshSessionRecord | null>;
  revokeRefreshSession(id: string, reason: string): Promise<void>;
  revokeRefreshFamily(tokenFamilyId: string, reason: string): Promise<number>;
}
