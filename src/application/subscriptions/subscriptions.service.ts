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

  async create(input: CreateSubscriptionCommand, actorId: string) {
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
      entitlements: version.features,
      notes: input.notes,
      createdById: actorId,
      deviceInstallationId: deviceId,
    });
    await this.audit.record({
      actorId,
      action: 'subscription.created',
      resourceType: 'subscription',
      resourceId: subscription.id,
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
    input: { startsAt?: string; expiresAt?: string; reason?: string },
  ) {
    const current = await this.get(id);
    if (current.status === 'CANCELLED') {
      throw new InvalidOperationError(
        'A cancelled subscription cannot be renewed.',
      );
    }
    const startsAt = input.startsAt
      ? new Date(input.startsAt)
      : current.expiresAt && current.expiresAt > new Date()
        ? current.expiresAt
        : new Date();
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : this.calculateExpiry(startsAt, current.billingInterval);
    if (!expiresAt || expiresAt <= startsAt) {
      throw new InvalidOperationError(
        'Renewal expiration must be after its start date.',
      );
    }
    const updated = await this.subscriptions.renew(
      id,
      current.status,
      startsAt,
      expiresAt,
      actorId,
      input.reason,
    );
    await this.audit.record({
      actorId,
      action: 'subscription.renewed',
      resourceType: 'subscription',
      resourceId: id,
      metadata: { startsAt, expiresAt },
    });
    return updated;
  }

  async events(id: string) {
    await this.get(id);
    return this.subscriptions.events(id);
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
