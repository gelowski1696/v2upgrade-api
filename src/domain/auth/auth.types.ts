export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface UserAccount {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
}

export interface RefreshSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  tokenFamilyId: string;
  replacedBySessionId: string | null;
  revokedReason: string | null;
  browserSession: boolean;
  persistent: boolean;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}
