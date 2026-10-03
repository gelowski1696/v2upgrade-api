import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import {
  CLIENT_REPOSITORY,
  type ClientRepository,
} from '../../domain/clients/client.repository.js';
import {
  PLAN_REPOSITORY,
  type BillingInterval,
  type PlanRepository,
} from '../../domain/plans/plan.repository.js';
import {
  ConflictError,
  InvalidOperationError,
  NotFoundError,
} from '../../domain/shared/errors.js';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
  type SubscriptionStatus,
} from '../../domain/subscriptions/subscription.repository.js';
import {
  featureModsFromEntitlements,
  validateFeatureMods,
  webDashboardEnabled,
} from '../../domain/subscriptions/feature-mods.js';

const allowedTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  DRAFT: ['TRIAL', 'ACTIVE', 'CANCELLED'],
  TRIAL: ['ACTIVE', 'GRACE', 'SUSPENDED', 'EXPIRED', 'CANCELLED'],
  ACTIVE: ['GRACE', 'SUSPENDED', 'EXPIRED', 'CANCELLED'],
  GRACE: ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED'],
  EXPIRED: ['ACTIVE', 'CANCELLED'],
  CANCELLED: [],
};

export interface CreateSubscriptionCommand {
  clientId: string;
  planVersionId: string;
  deviceId: string;
  startsAt?: string;
  expiresAt?: string;
  notes?: string;
  featureOverrides?: Record<string, unknown>;
  webDashboardEnabled?: boolean;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: SubscriptionRepository,
    @Inject(CLIENT_REPOSITORY) private readonly clients: ClientRepository,
    @Inject(PLAN_REPOSITORY) private readonly plans: PlanRepository,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  list(input: {
    page: number;
    pageSize: number;
    search?: string;
    status?: SubscriptionStatus;
    clientId?: string;
  }) {
    return this.subscriptions.list(input);
  }

  async get(id: string) {
    const subscription = await this.subscriptions.findById(id);
    if (!subscription) throw new NotFoundError('Subscription');
    return subscription;
  }

  async create(
    input: CreateSubscriptionCommand,
    actorId: string,
    canManageFeatures = false,
  ) {
    if (
      !canManageFeatures &&
      (Object.keys(input.featureOverrides ?? {}).length > 0 ||
        input.webDashboardEnabled !== undefined)
    ) {
      throw new InvalidOperationError(
        'Only administrators can override subscription features.',
        'FEATURE_OVERRIDE_FORBIDDEN',
      );
    }
    const deviceId = this.normalizeDeviceId(input.deviceId);
    const assignedDevice = await this.subscriptions.findByDeviceId(deviceId);
    if (assignedDevice) {
      throw new ConflictError(
        'Device ID is already assigned to another subscription.',
        'DEVICE_ALREADY_ASSIGNED',
      );
    }

    const client = await this.clients.findById(input.clientId);
    if (!client) throw new NotFoundError('Client');
    if (client.status !== 'ACTIVE') {
      throw new InvalidOperationError(
        'Subscriptions require an active client.',
      );
    }

    const version = await this.plans.findVersion(input.planVersionId);
    if (!version) throw new NotFoundError('Plan version');
    const plan = await this.plans.findById(version.planId);
    if (!plan || plan.status !== 'ACTIVE' || !version.publishedAt) {
      throw new InvalidOperationError(
        'Subscriptions require a published plan version.',
      );
    }

    const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : this.calculateExpiry(startsAt, version.billingInterval);
    if (!expiresAt) {
      throw new InvalidOperationError(
        'A custom billing interval requires an expiration date.',
      );
    }
    if (expiresAt <= startsAt) {
      throw new InvalidOperationError(
        'Expiration must be after the start date.',
      );
    }

    let featureOverrides = {};
    try {
      featureOverrides = validateFeatureMods(input.featureOverrides ?? {});
    } catch (error) {
      throw new InvalidOperationError(
        error instanceof Error
          ? error.message
          : 'Feature overrides are invalid.',
        'INVALID_FEATURE_MODS',
      );
    }
    const entitlements = {
      ...version.features,
      ...featureOverrides,
      ...(input.webDashboardEnabled === undefined
        ? {}
        : { webDashboard: input.webDashboardEnabled }),
    };

    const subscription = await this.subscriptions.create({
      clientId: client.id,
      planVersionId: version.id,
      startsAt,
      renewsAt: expiresAt,
      expiresAt,
      amount: version.amount,
      currency: version.currency,
      billingInterval: version.billingInterval,
      maxDevices: 1,
      entitlements,
      notes: input.notes,
      createdById: actorId,
      deviceInstallationId: deviceId,
    });
    await this.audit.record({
      actorId,
      action: 'subscription.created',
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: {
        featureOverrides,
        webDashboardEnabled: input.webDashboardEnabled,
      },
    });
    return subscription;
  }

  async transition(
    id: string,
    target: SubscriptionStatus,
    actorId: string,
    reason?: string,
  ) {
    const current = await this.get(id);
    if (!allowedTransitions[current.status].includes(target)) {
      throw new InvalidOperationError(
        `Subscription cannot move from ${current.status} to ${target}.`,
        'INVALID_SUBSCRIPTION_TRANSITION',
      );
    }
    const updated = await this.subscriptions.transition(
      id,
      current.status,
      target,
      actorId,
      reason,
    );
    await this.audit.record({
      actorId,
      action: `subscription.${target.toLowerCase()}`,
      resourceType: 'subscription',
      resourceId: id,
      metadata: { from: current.status, to: target, reason },
    });
    return updated;
  }

  async renew(
    id: string,
    actorId: string,
    input: {
      periodStartsAt?: string;
      periodEndsAt?: string;
      reason?: string;
    },
    allowDateOverride = false,
  ) {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') {
      throw new InvalidOperationError(
        'A cancelled subscription cannot be renewed.',
      );
    }
    const now = new Date();
    const defaultPeriodStart =
      current.expiresAt && current.expiresAt > now ? current.expiresAt : now;
    const hasOverride = Boolean(input.periodStartsAt || input.periodEndsAt);
    if (hasOverride && !allowDateOverride) {
      throw new InvalidOperationError(
        'Only an administrator can override renewal dates.',
      );
    }
    if (hasOverride && !input.reason?.trim()) {
      throw new InvalidOperationError(
        'A reason is required when renewal dates are overridden.',
      );
    }
    const periodStartsAt = input.periodStartsAt
      ? new Date(input.periodStartsAt)
      : defaultPeriodStart;
    const periodEndsAt = input.periodEndsAt
      ? new Date(input.periodEndsAt)
      : this.calculateExpiry(periodStartsAt, current.billingInterval);
    if (!periodEndsAt || periodEndsAt <= periodStartsAt) {
      throw new InvalidOperationError(
        'Renewal period end must be after its period start.',
      );
    }
    const result = await this.subscriptions.renew(
      id,
      current.status,
      current.expiresAt,
      periodStartsAt,
      periodEndsAt,
      actorId,
      {
        amount: current.amount,
        currency: current.currency,
        billingInterval: current.billingInterval,
      },
      input.reason,
    );
    await this.audit.record({
      actorId,
      action: 'subscription.renewed',
      resourceType: 'subscription',
      resourceId: id,
      metadata: {
        renewalId: result.renewal.id,
        originalStartsAt: current.startsAt,
        previousExpiresAt: current.expiresAt,
        periodStartsAt,
        periodEndsAt,
      },
    });
    return result;
  }

  async events(id: string) {
    await this.get(id);
    return this.subscriptions.events(id);
  }

  async renewals(id: string) {
    await this.get(id);
    return this.subscriptions.renewals(id);
  }

  async delete(id: string, actorId: string) {
    const subscription = await this.get(id);
    const deletedAt = new Date();
    await this.subscriptions.softDelete(id, actorId, deletedAt);
    await this.audit.record({
      actorId,
      action: 'subscription.deleted',
      resourceType: 'subscription',
      resourceId: id,
      metadata: {
        clientId: subscription.clientId,
        planVersionId: subscription.planVersionId,
        previousStatus: subscription.status,
        deviceId: subscription.device?.installationId,
      },
    });
    return { deleted: true, deletedAt };
  }

  async updateFeatureMods(
    id: string,
    input: Record<string, unknown>,
    actorId: string,
  ) {
    const current = await this.get(id);
    let featureMods;
    try {
      featureMods = validateFeatureMods(input);
    } catch (error) {
      throw new InvalidOperationError(
        error instanceof Error ? error.message : 'Feature mods are invalid.',
        'INVALID_FEATURE_MODS',
      );
    }
    const updated = await this.subscriptions.updateEntitlements(id, {
      ...current.entitlements,
      ...featureMods,
    });
    await this.audit.record({
      actorId,
      action: 'subscription.feature_mods_updated',
      resourceType: 'subscription',
      resourceId: id,
      metadata: { featureMods },
    });
    return updated;
  }

  async updateFeatures(
    id: string,
    input: Record<string, unknown>,
    webDashboard: boolean,
    actorId: string,
  ) {
    const current = await this.get(id);
    let featureMods;
    try {
      featureMods = validateFeatureMods(input);
    } catch (error) {
      throw new InvalidOperationError(
        error instanceof Error ? error.message : 'Features are invalid.',
        'INVALID_FEATURE_MODS',
      );
    }
    const updated = await this.subscriptions.updateEntitlements(id, {
      ...current.entitlements,
      ...featureMods,
      webDashboard,
    });
    await this.audit.record({
      actorId,
      action: 'subscription.features_updated',
      resourceType: 'subscription',
      resourceId: id,
      metadata: { featureMods, webDashboardEnabled: webDashboard },
    });
    return updated;
  }

  async updateWebDashboard(id: string, enabled: boolean, actorId: string) {
    const current = await this.get(id);
    const updated = await this.subscriptions.updateEntitlements(id, {
      ...current.entitlements,
      webDashboard: enabled,
    });
    await this.audit.record({
      actorId,
      action: enabled
        ? 'subscription.web_dashboard_enabled'
        : 'subscription.web_dashboard_disabled',
      resourceType: 'subscription',
      resourceId: id,
    });
    return updated;
  }

  async validateDevice(deviceId: string) {
    const checkedAt = new Date();
    const device = await this.subscriptions.findByDeviceId(
      this.normalizeDeviceId(deviceId),
    );
    if (!device || !device.subscription) {
      return this.invalidLicense(
        'DEVICE_NOT_FOUND',
        'Device ID is not registered.',
        checkedAt,
      );
    }
    if (device.status !== 'ACTIVE') {
      return this.invalidLicense(
        'DEVICE_REVOKED',
        'This device has been revoked.',
        checkedAt,
      );
    }

    const subscription = device.subscription;
    if (!['ACTIVE', 'TRIAL', 'GRACE'].includes(subscription.status)) {
      return this.invalidLicense(
        'SUBSCRIPTION_INACTIVE',
        `Subscription is ${subscription.status.toLowerCase()}.`,
        checkedAt,
      );
    }
    if (subscription.startsAt > checkedAt) {
      return this.invalidLicense(
        'SUBSCRIPTION_NOT_STARTED',
        'Subscription has not started yet.',
        checkedAt,
      );
    }

    const validUntil =
      subscription.status === 'GRACE'
        ? subscription.graceEndsAt
        : subscription.expiresAt;
    if (validUntil && validUntil < checkedAt) {
      return this.invalidLicense(
        'SUBSCRIPTION_EXPIRED',
        'Subscription has expired.',
        checkedAt,
      );
    }

    await this.subscriptions.touchDevice(device.id, checkedAt);
    const deviceAccessToken = await this.jwt.signAsync(
      {
        sub: device.id,
        clientId: device.clientId,
        storeId: device.storeId,
        installationId: device.installationId,
        tokenUse: 'device-sync',
      },
      {
        secret: this.config.getOrThrow<string>('DEVICE_JWT_SECRET'),
        audience: 'posv2-device',
        issuer: 'posv2-subscriptions',
        expiresIn: this.config.get<string>(
          'DEVICE_TOKEN_TTL',
          '12h',
        ) as SignOptions['expiresIn'],
      },
    );
    return {
      valid: true,
      code: 'VALID',
      message: 'Subscription is valid.',
      checkedAt,
      deviceAccessToken,
      storeId: device.storeId,
      featureMods: featureModsFromEntitlements(subscription.entitlements),
      webDashboardEnabled: webDashboardEnabled(subscription.entitlements),
      subscription: {
        id: subscription.id,
        status: subscription.status,
        expiresAt: subscription.expiresAt,
        graceEndsAt: subscription.graceEndsAt,
        clientName: subscription.client.businessName,
        planName: subscription.planVersion.plan.name,
      },
    };
  }

  async assignDevice(id: string, deviceId: string, actorId: string) {
    const subscription = await this.get(id);
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    const assignedDevice =
      await this.subscriptions.findByDeviceId(normalizedDeviceId);
    if (assignedDevice?.subscription?.id === id) return subscription;
    if (assignedDevice) {
      throw new ConflictError(
        'Device ID is already assigned to another subscription.',
        'DEVICE_ALREADY_ASSIGNED',
      );
    }

    const updated = await this.subscriptions.assignDevice(
      id,
      subscription.clientId,
      normalizedDeviceId,
    );
    await this.audit.record({
      actorId,
      action: 'subscription.device_assigned',
      resourceType: 'subscription',
      resourceId: id,
      metadata: { deviceId: normalizedDeviceId },
    });
    return updated;
  }

  private invalidLicense(code: string, message: string, checkedAt: Date) {
    return { valid: false, code, message, checkedAt, subscription: null };
  }

  private normalizeDeviceId(value: string): string {
    return value.trim().toUpperCase();
  }

  private calculateExpiry(start: Date, interval: BillingInterval): Date | null {
    const months = {
      MONTHLY: 1,
      QUARTERLY: 3,
      SEMIANNUAL: 6,
      ANNUAL: 12,
    } as const;
    if (interval === 'CUSTOM') return null;
    const result = new Date(start);
    result.setUTCMonth(result.getUTCMonth() + months[interval]);
    return result;
  }
}
