export type PortalRole = 'OWNER' | 'MANAGER' | 'VIEWER';

export interface AuthenticatedPortalUser {
  id: string;
  sessionId: string;
  clientId: string;
  username: string;
  displayName: string;
  role: PortalRole;
  storeIds: string[];
}
