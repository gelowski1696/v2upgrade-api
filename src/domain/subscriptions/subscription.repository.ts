import type { BillingInterval } from '../plans/plan.repository.js';
import type { Page, PageQuery } from '../shared/page.js';

export type SubscriptionStatus =
  | 'DRAFT'
  | 'TRIAL'
  | 'ACTIVE'
  | 'GRACE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface SubscriptionRecord {
  id: string;
  clientId: string;
  planVersionId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  renewsAt: Date | null;
  expiresAt: Date | null;
  graceEndsAt: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  amount: string;
  currency: string;
  billingInterval: BillingInterval;
  maxDevices: number;
  entitlements: Record<string, unknown>;
  notes: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  client: { id: string; code: string; businessName: string };
  planVersion: {
    id: string;
    version: number;
    plan: { id: string; code: string; name: string };
  };
  device: {
    id: string;
    installationId: string;
    label: string | null;
    platform: string;
    status: 'ACTIVE' | 'REVOKED';
    lastSeenAt: Date | null;
  } | null;
}

export interface DeviceLicenseRecord {
  id: string;
  clientId: string;
  storeId: string;
  installationId: string;
  status: 'ACTIVE' | 'REVOKED';
  subscription: SubscriptionRecord | null;
}

export interface SubscriptionEventRecord {
  id: string;
  subscriptionId: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  reason: string | null;
  createdAt: Date;
  actor: { id: string; displayName: string };
}

export interface CreateSubscriptionInput {
  clientId: string;
  planVersionId: string;
  startsAt: Date;
  renewsAt: Date | null;
  expiresAt: Date | null;
  amount: string;
  currency: string;
  billingInterval: BillingInterval;
  maxDevices: number;
  entitlements: Record<string, unknown>;
  notes?: string;
  createdById: string;
  deviceInstallationId: string;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');

export interface SubscriptionRepository {
  list(
    query: PageQuery & { status?: SubscriptionStatus; clientId?: string },
  ): Promise<Page<SubscriptionRecord>>;
  findById(id: string): Promise<SubscriptionRecord | null>;
  findByDeviceId(
    deviceInstallationId: string,
  ): Promise<DeviceLicenseRecord | null>;
  touchDevice(id: string, seenAt: Date): Promise<void>;
  assignDevice(
    subscriptionId: string,
    clientId: string,
    deviceInstallationId: string,
  ): Promise<SubscriptionRecord>;
  create(input: CreateSubscriptionInput): Promise<SubscriptionRecord>;
  updateEntitlements(
    id: string,
    entitlements: Record<string, unknown>,
  ): Promise<SubscriptionRecord>;
  transition(
    id: string,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
    actorId: string,
    reason?: string,
  ): Promise<SubscriptionRecord>;
  renew(
    id: string,
    fromStatus: SubscriptionStatus,
    startsAt: Date,
    expiresAt: Date,
    actorId: string,
    reason?: string,
  ): Promise<SubscriptionRecord>;
  softDelete(id: string, actorId: string, deletedAt: Date): Promise<void>;
  events(id: string): Promise<SubscriptionEventRecord[]>;
}
