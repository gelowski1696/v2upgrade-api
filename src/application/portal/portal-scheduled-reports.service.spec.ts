import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { PortalMailerService } from '../../infrastructure/email/portal-mailer.service.js';
import { PortalDashboardService } from './portal-dashboard.service.js';
import { PortalScheduledReportsService } from './portal-scheduled-reports.service.js';

describe('PortalScheduledReportsService', () => {
  const user: AuthenticatedPortalUser = {
    id: 'portal-user',
    sessionId: 'session-one',
    clientId: 'client-one',
    username: 'owner@example.test',
    displayName: 'Owner',
    role: 'OWNER',
    storeIds: ['store-one'],
  };
  let prisma: any;
  let dashboard: any;
  let mailer: any;
  let service: PortalScheduledReportsService;

  beforeEach(() => {
    prisma = {
      portalUser: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          username: user.username,
          emailVerifiedAt: new Date('2026-09-27T01:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      store: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'store-one',
          timezone: 'Asia/Manila',
        }),
      },
      portalReportSchedule: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn().mockResolvedValue({
          id: 'schedule-one',
          storeId: 'store-one',
          frequency: 'DAILY',
          enabled: true,
          nextRunAt: new Date('2026-09-28T23:00:00.000Z'),
          lastAttemptAt: null,
          lastSuccessAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      portalReportDelivery: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      billingStatementDelivery: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      portalEmailVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'verification-one' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    dashboard = {
      overview: jest.fn().mockResolvedValue({
        snapshotCreatedAt: '2026-09-25T00:00:00.000Z',
        data: {
          grossSales: 1000,
          transactionCount: 4,
          grossProfit: 400,
          customerBalance: 200,
          criticalItems: 1,
          transfers: 2,
          profitDataComplete: true,
        },
      }),
    };
    mailer = {
      configured: true,
      send: jest
        .fn()
        .mockResolvedValue({ providerMessageId: 'resend-email-one' }),
      verifyWebhook: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'PORTAL_SCHEDULED_REPORTS_ENABLED' ? true : fallback,
      ),
      getOrThrow: jest
        .fn()
        .mockReturnValue('portal-secret-at-least-32-characters'),
    };
    service = new PortalScheduledReportsService(
      prisma as PrismaService,
      dashboard as PortalDashboardService,
      mailer as PortalMailerService,
      config as unknown as ConfigService,
    );
  });

  it('does not query or process schedules when scheduled reports are disabled', async () => {
    const disabledConfig = {
      get: jest.fn((_key: string, fallback: unknown) => fallback),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const disabledService = new PortalScheduledReportsService(
      prisma as PrismaService,
      dashboard as PortalDashboardService,
      mailer as PortalMailerService,
      disabledConfig,
    );

    await expect(disabledService.list(user)).resolves.toMatchObject({
      scheduledReportsEnabled: false,
      emailDeliveryConfigured: false,
      schedules: [],
      deliveries: [],
    });
    await disabledService.processDueReports();

    expect(prisma.portalUser.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.portalReportDelivery.updateMany).not.toHaveBeenCalled();
    expect(prisma.portalReportSchedule.findMany).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    await expect(
      disabledService.update(user, {
        storeId: 'store-one',
        frequency: 'DAILY',
        enabled: true,
      }),
    ).rejects.toThrow('Scheduled email reports are disabled');
  });

  it('enables a store-scoped daily schedule for a verified address', async () => {
    await expect(
      service.update(user, {
        storeId: 'store-one',
        frequency: 'DAILY',
        enabled: true,
      }),
    ).resolves.toMatchObject({ enabled: true, frequency: 'DAILY' });
    expect(prisma.portalReportSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          portalUserId: user.id,
          storeId: 'store-one',
          frequency: 'DAILY',
          enabled: true,
          nextRunAt: expect.any(Date),
        }),
      }),
    );
  });

  it('does not enable delivery until the portal email is verified', async () => {
    prisma.portalUser.findUniqueOrThrow.mockResolvedValueOnce({
      username: user.username,
      emailVerifiedAt: null,
    });
    await expect(
      service.update(user, {
        storeId: 'store-one',
        frequency: 'WEEKLY',
        enabled: true,
      }),
    ).rejects.toThrow('Verify the portal account email');
    expect(prisma.portalReportSchedule.upsert).not.toHaveBeenCalled();
  });

  it('sends a short-lived verification code only to the portal username', async () => {
    prisma.portalUser.findUniqueOrThrow.mockResolvedValueOnce({
      username: user.username,
      emailVerifiedAt: null,
    });
    await service.requestEmailVerification(user);
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: user.username,
        subject: 'Verify scheduled report delivery',
      }),
    );
    expect(prisma.portalEmailVerification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          portalUserId: user.id,
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('records a sent summary with snapshot age and a visible stale-data warning', async () => {
    const schedule = {
      id: 'schedule-one',
      portalUserId: user.id,
      storeId: 'store-one',
      frequency: 'DAILY',
      enabled: true,
      nextRunAt: new Date('2026-09-27T00:00:00.000Z'),
      user: {
        ...user,
        status: 'ACTIVE',
        emailVerifiedAt: new Date('2026-09-26T00:00:00.000Z'),
      },
      store: { id: 'store-one', name: 'Main Store', timezone: 'Asia/Manila' },
    };
    const delivery = {
      id: 'delivery-one',
      scheduleId: schedule.id,
      periodFrom: '2026-09-26',
      periodTo: '2026-09-26',
      status: 'PENDING',
      attemptCount: 0,
      schedule,
    };
    prisma.portalReportSchedule.findMany.mockResolvedValueOnce([schedule]);
    prisma.portalReportDelivery.upsert.mockResolvedValue(delivery);

    await service.processDueReports();

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: user.username,
        subject: expect.stringContaining('[STALE DATA]'),
        attachments: [
          expect.objectContaining({ contentType: 'text/csv; charset=utf-8' }),
        ],
      }),
    );
    expect(prisma.portalReportDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          dataQualityStatus: 'COMPLETE',
          warning: expect.stringContaining('hours old'),
          providerMessageId: 'resend-email-one',
          providerStatus: 'email.sent',
        }),
      }),
    );
  });

  it('records signed Resend delivery and bounce outcomes', async () => {
    mailer.verifyWebhook.mockReturnValueOnce({
      type: 'email.delivered',
      created_at: '2026-09-27T08:00:00.000Z',
      data: { email_id: 'resend-email-one' },
    });
    await service.handleResendWebhook('signed payload', {
      id: 'message-id',
      timestamp: 'timestamp',
      signature: 'signature',
    });
    expect(prisma.portalReportDelivery.updateMany).toHaveBeenLastCalledWith({
      where: {
        providerMessageId: 'resend-email-one',
        status: { notIn: ['BOUNCED', 'COMPLAINED'] },
      },
      data: expect.objectContaining({
        status: 'DELIVERED',
        providerStatus: 'email.delivered',
        deliveredAt: new Date('2026-09-27T08:00:00.000Z'),
      }),
    });

    mailer.verifyWebhook.mockReturnValueOnce({
      type: 'email.bounced',
      created_at: '2026-09-27T08:05:00.000Z',
      data: { email_id: 'resend-email-two' },
    });
    await service.handleResendWebhook('signed payload', {
      id: 'message-id-two',
      timestamp: 'timestamp',
      signature: 'signature',
    });
    expect(prisma.portalReportDelivery.updateMany).toHaveBeenLastCalledWith({
      where: { providerMessageId: 'resend-email-two' },
      data: {
        status: 'BOUNCED',
        providerStatus: 'email.bounced',
        errorCode: 'RESEND_BOUNCED',
        nextAttemptAt: null,
      },
    });
  });

  it('rejects an invalid Resend webhook signature without changing delivery state', async () => {
    mailer.verifyWebhook.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });
    await expect(
      service.handleResendWebhook('forged payload', {
        id: 'message-id',
        timestamp: 'timestamp',
        signature: 'forged-signature',
      }),
    ).rejects.toThrow('Resend webhook signature is invalid');
    expect(prisma.portalReportDelivery.updateMany).not.toHaveBeenCalled();
  });
});
