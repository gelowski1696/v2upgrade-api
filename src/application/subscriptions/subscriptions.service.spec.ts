import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuditWriter } from '../../domain/audit/audit-writer.js';
import type { ClientRepository } from '../../domain/clients/client.repository.js';
import type { PlanRepository } from '../../domain/plans/plan.repository.js';
import { InvalidOperationError } from '../../domain/shared/errors.js';
import type {
  SubscriptionRecord,
  SubscriptionRepository,
} from '../../domain/subscriptions/subscription.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

describe('SubscriptionsService', () => {
  const clients: jest.Mocked<ClientRepository> = {
    list: jest.fn(),
    findById: jest.fn(),
    findByCode: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const plans: jest.Mocked<PlanRepository> = {
    list: jest.fn(),
    findById: jest.fn(),
    findByCode: jest.fn(),
    findVersion: jest.fn(),
    create: jest.fn(),
    addVersion: jest.fn(),
    publishVersion: jest.fn(),
    archive: jest.fn(),
  };
  const subscriptions: jest.Mocked<SubscriptionRepository> = {
    list: jest.fn(),
    findById: jest.fn(),
    findByDeviceId: jest.fn(),
    touchDevice: jest.fn(),
    assignDevice: jest.fn(),
    create: jest.fn(),
    updateEntitlements: jest.fn(),
    transition: jest.fn(),
    renew: jest.fn(),
    softDelete: jest.fn(),
    events: jest.fn(),
  };
  const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('device-access-token'),
  } as unknown as JwtService;
  const config = {
    getOrThrow: jest
      .fn()
      .mockReturnValue('device-secret-with-at-least-32-characters'),
    get: jest
      .fn()
      .mockImplementation((_key: string, fallback: unknown) => fallback),
  } as unknown as ConfigService;
  const service = new SubscriptionsService(
    subscriptions,
    clients,
    plans,
    audit,
    jwt,
    config,
  );

  beforeEach(() => jest.clearAllMocks());

  it('snapshots a published plan version into a new subscription', async () => {
    clients.findById.mockResolvedValue({
      id: 'client-id',
      code: 'CLIENT-1',
      businessName: 'Client One',
      ownerName: null,
      email: null,
      phone: null,
      address: null,
      notes: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    plans.findVersion.mockResolvedValue({
      id: 'version-id',
      planId: 'plan-id',
      version: 1,
      billingInterval: 'MONTHLY',
      amount: '1499.00',
      currency: 'PHP',
      trialDays: 0,
      graceDays: 7,
      maxDevices: 2,
      features: { reports: true },
      publishedAt: new Date(),
      createdAt: new Date(),
    });
    plans.findById.mockResolvedValue({
      id: 'plan-id',
      code: 'STANDARD',
      name: 'Standard',
      status: 'ACTIVE',
      versions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    subscriptions.create.mockImplementation((input) =>
      Promise.resolve({
        id: 'subscription-id',
        ...input,
        status: 'DRAFT',
        graceEndsAt: null,
        suspendedAt: null,
        cancelledAt: null,
        notes: input.notes ?? null,
        device: {
          id: 'device-row-id',
          installationId: input.deviceInstallationId,
          label: 'Primary POS',
          platform: 'windows',
          status: 'ACTIVE',
          lastSeenAt: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        client: {
          id: 'client-id',
          code: 'CLIENT-1',
          businessName: 'Client One',
        },
        planVersion: {
          id: 'version-id',
          version: 1,
          plan: { id: 'plan-id', code: 'STANDARD', name: 'Standard' },
        },
      }),
    );

    await service.create(
      {
        clientId: 'client-id',
        planVersionId: 'version-id',
        deviceId: 'pos-device-0001',
        startsAt: '2026-01-15T00:00:00.000Z',
      },
      'actor-id',
    );

    expect(subscriptions.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        amount: '1499.00',
        currency: 'PHP',
        maxDevices: 1,
        deviceInstallationId: 'POS-DEVICE-0001',
        entitlements: { reports: true },
        expiresAt: new Date('2026-02-15T00:00:00.000Z'),
      }),
    );
    expect(audit.record.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ action: 'subscription.created' }),
    );
  });

  it('blocks invalid lifecycle transitions', async () => {
    subscriptions.findById.mockResolvedValue({
      id: 'subscription-id',
      clientId: 'client-id',
      planVersionId: 'version-id',
      status: 'CANCELLED',
      startsAt: new Date(),
      renewsAt: null,
      expiresAt: null,
      graceEndsAt: null,
      suspendedAt: null,
      cancelledAt: new Date(),
      amount: '1499.00',
      currency: 'PHP',
      billingInterval: 'MONTHLY',
      maxDevices: 1,
      entitlements: {},
      notes: null,
      createdById: 'actor-id',
      createdAt: new Date(),
      updatedAt: new Date(),
      client: { id: 'client-id', code: 'CLIENT-1', businessName: 'Client One' },
      planVersion: {
        id: 'version-id',
        version: 1,
        plan: { id: 'plan-id', code: 'STANDARD', name: 'Standard' },
      },
      device: null,
    } satisfies SubscriptionRecord);

    await expect(
      service.transition('subscription-id', 'ACTIVE', 'actor-id'),
    ).rejects.toBeInstanceOf(InvalidOperationError);
    expect(subscriptions.transition.mock.calls).toHaveLength(0);
  });

  it('validates an active subscription and records device activity', async () => {
    const subscription = {
      id: 'subscription-id',
      clientId: 'client-id',
      planVersionId: 'version-id',
      status: 'ACTIVE',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      renewsAt: new Date('2099-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      graceEndsAt: null,
      suspendedAt: null,
      cancelledAt: null,
      amount: '1499.00',
      currency: 'PHP',
      billingInterval: 'MONTHLY',
      maxDevices: 1,
      entitlements: {
        reports: true,
        summaryCsv: true,
        discountReport: false,
      },
      notes: null,
      createdById: 'actor-id',
      createdAt: new Date(),
      updatedAt: new Date(),
      client: { id: 'client-id', code: 'CLIENT-1', businessName: 'Client One' },
      planVersion: {
        id: 'version-id',
        version: 1,
        plan: { id: 'plan-id', code: 'STANDARD', name: 'Standard' },
      },
      device: null,
    } satisfies SubscriptionRecord;
    subscriptions.findByDeviceId.mockResolvedValue({
      id: 'device-row-id',
      storeId: 'store-id',
      installationId: 'POS-DEVICE-0001',
      status: 'ACTIVE',
      subscription,
    });

    await expect(service.validateDevice('pos-device-0001')).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        code: 'VALID',
        featureMods: { summaryCsv: true, discountReport: false },
        webDashboardEnabled: true,
      }),
    );
    expect(subscriptions.touchDevice.mock.calls[0]).toEqual([
      'device-row-id',
      expect.any(Date),
    ]);
  });

  it('updates feature mods without discarding other entitlements', async () => {
    const current = {
      id: 'subscription-id',
      clientId: 'client-id',
      planVersionId: 'version-id',
      status: 'ACTIVE',
      startsAt: new Date(),
      renewsAt: null,
      expiresAt: null,
      graceEndsAt: null,
      suspendedAt: null,
      cancelledAt: null,
      amount: '1499.00',
      currency: 'PHP',
      billingInterval: 'MONTHLY',
      maxDevices: 1,
      entitlements: { reports: true, summaryCsv: false },
      notes: null,
      createdById: 'actor-id',
      createdAt: new Date(),
      updatedAt: new Date(),
      client: { id: 'client-id', code: 'CLIENT-1', businessName: 'Client One' },
      planVersion: {
        id: 'version-id',
        version: 1,
        plan: { id: 'plan-id', code: 'STANDARD', name: 'Standard' },
      },
      device: null,
    } satisfies SubscriptionRecord;
    subscriptions.findById.mockResolvedValue(current);
    subscriptions.updateEntitlements.mockResolvedValue({
      ...current,
      entitlements: { reports: true, summaryCsv: true },
    });

    await service.updateFeatureMods(
      'subscription-id',
      { summaryCsv: true },
      'admin-id',
    );

    expect(subscriptions.updateEntitlements.mock.calls[0]).toEqual([
      'subscription-id',
      { reports: true, summaryCsv: true },
    ]);
    expect(audit.record.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ action: 'subscription.feature_mods_updated' }),
    );
  });

  it('updates web dashboard access without discarding feature mods', async () => {
    const current = {
      id: 'subscription-id',
      clientId: 'client-id',
      planVersionId: 'version-id',
      status: 'ACTIVE',
      startsAt: new Date(),
      renewsAt: null,
      expiresAt: null,
      graceEndsAt: null,
      suspendedAt: null,
      cancelledAt: null,
      amount: '1499.00',
      currency: 'PHP',
      billingInterval: 'MONTHLY',
      maxDevices: 1,
      entitlements: { summaryCsv: true },
      notes: null,
      createdById: 'actor-id',
      createdAt: new Date(),
      updatedAt: new Date(),
      client: { id: 'client-id', code: 'CLIENT-1', businessName: 'Client One' },
      planVersion: {
        id: 'version-id',
        version: 1,
        plan: { id: 'plan-id', code: 'STANDARD', name: 'Standard' },
      },
      device: null,
    } satisfies SubscriptionRecord;
    subscriptions.findById.mockResolvedValue(current);
    subscriptions.updateEntitlements.mockResolvedValue({
      ...current,
      entitlements: { summaryCsv: true, webDashboard: false },
    });

    await service.updateWebDashboard('subscription-id', false, 'admin-id');

    expect(subscriptions.updateEntitlements.mock.calls[0]).toEqual([
      'subscription-id',
      { summaryCsv: true, webDashboard: false },
    ]);
    expect(audit.record.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        action: 'subscription.web_dashboard_disabled',
      }),
    );
  });

  it('soft deletes a subscription and preserves an audit record', async () => {
    subscriptions.findById.mockResolvedValue(
      subscriptionRecord({
        status: 'ACTIVE',
        device: {
          id: 'device-row-id',
          installationId: 'POS-DEVICE-0001',
          label: 'Primary POS',
          platform: 'windows',
          status: 'ACTIVE',
          lastSeenAt: null,
        },
      }),
    );
    subscriptions.softDelete.mockResolvedValue();

    const result = await service.delete('subscription-id', 'admin-id');

    expect(subscriptions.softDelete.mock.calls[0]?.[0]).toBe('subscription-id');
    expect(subscriptions.softDelete.mock.calls[0]?.[1]).toBe('admin-id');
    expect(subscriptions.softDelete.mock.calls[0]?.[2]).toBeInstanceOf(Date);
    expect(result.deleted).toBe(true);
    expect(result.deletedAt).toBeInstanceOf(Date);
    const recorded = audit.record.mock.calls[0]?.[0];
    expect(recorded?.action).toBe('subscription.deleted');
    expect(recorded?.resourceId).toBe('subscription-id');
    expect(recorded?.metadata?.['previousStatus']).toBe('ACTIVE');
    expect(recorded?.metadata?.['deviceId']).toBe('POS-DEVICE-0001');
  });
});

function subscriptionRecord(
  overrides: Partial<SubscriptionRecord> = {},
): SubscriptionRecord {
  return {
    id: 'subscription-id',
    clientId: 'client-id',
    planVersionId: 'version-id',
    status: 'DRAFT',
    startsAt: new Date(),
    renewsAt: null,
    expiresAt: null,
    graceEndsAt: null,
    suspendedAt: null,
    cancelledAt: null,
    amount: '1499.00',
    currency: 'PHP',
    billingInterval: 'MONTHLY',
    maxDevices: 1,
    entitlements: {},
    notes: null,
    createdById: 'actor-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    client: { id: 'client-id', code: 'CLIENT-1', businessName: 'Client One' },
    planVersion: {
      id: 'version-id',
      version: 1,
      plan: { id: 'plan-id', code: 'STANDARD', name: 'Standard' },
    },
    device: null,
    ...overrides,
  };
}
