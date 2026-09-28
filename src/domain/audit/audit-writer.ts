export const AUDIT_WRITER = Symbol('AUDIT_WRITER');

export interface AuditWriter {
  record(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
