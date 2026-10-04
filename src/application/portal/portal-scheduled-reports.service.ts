import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'node:crypto';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { PortalMailerService } from '../../infrastructure/email/portal-mailer.service.js';
import { PortalDashboardService } from './portal-dashboard.service.js';

type ReportFrequency = 'DAILY' | 'WEEKLY';

@Injectable()
export class PortalScheduledReportsService
  implements OnModuleInit, OnModuleDestroy
{
  private worker: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: PortalDashboardService,
    private readonly mailer: PortalMailerService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<boolean>(
      'PORTAL_SCHEDULED_REPORTS_ENABLED',
      false,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.worker = setInterval(() => void this.processDueReports(), 60_000);
    this.worker.unref();
  }

  onModuleDestroy(): void {
    if (this.worker) clearInterval(this.worker);
  }

  async list(user: AuthenticatedPortalUser) {
    if (!this.enabled) {
      return {
        scheduledReportsEnabled: false,
        recipientEmail: user.username,
        emailVerifiedAt: null,
        emailDeliveryConfigured: false,
        deliveryTime: '07:00 store time',
        weeklyDeliveryDay: 'Monday',
        schedules: [],
        deliveries: [],
      };
    }
    const [account, schedules, deliveries] = await Promise.all([
      this.prisma.portalUser.findUniqueOrThrow({
        where: { id: user.id },
        select: { username: true, emailVerifiedAt: true },
      }),
      this.prisma.portalReportSchedule.findMany({
        where: { portalUserId: user.id, storeId: { in: user.storeIds } },
        select: {
          id: true,
          storeId: true,
          frequency: true,
          enabled: true,
          nextRunAt: true,
          lastAttemptAt: true,
          lastSuccessAt: true,
        },
        orderBy: [{ storeId: 'asc' }, { frequency: 'asc' }],
      }),
      this.prisma.portalReportDelivery.findMany({
        where: {
          schedule: {
            portalUserId: user.id,
            storeId: { in: user.storeIds },
          },
        },
        select: {
          id: true,
          schedule: { select: { storeId: true, frequency: true } },
          periodFrom: true,
          periodTo: true,
          status: true,
          attemptCount: true,
          snapshotAgeHours: true,
          dataQualityStatus: true,
          warning: true,
          providerMessageId: true,
          providerStatus: true,
          sentAt: true,
          deliveredAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      scheduledReportsEnabled: true,
      recipientEmail: account.username,
      emailVerifiedAt: account.emailVerifiedAt,
      emailDeliveryConfigured: this.mailer.configured,
      deliveryTime: '07:00 store time',
      weeklyDeliveryDay: 'Monday',
      schedules,
      deliveries: deliveries.map(({ schedule, ...delivery }) => ({
        ...delivery,
        storeId: schedule.storeId,
        frequency: schedule.frequency,
      })),
    };
  }

  async update(
    user: AuthenticatedPortalUser,
    input: { storeId: string; frequency: ReportFrequency; enabled: boolean },
  ) {
    this.requireEnabled();
    if (!user.storeIds.includes(input.storeId)) {
      throw new BadRequestException('Store is not available to this account.');
    }
    const [account, store, existing] = await Promise.all([
      this.prisma.portalUser.findUniqueOrThrow({
        where: { id: user.id },
        select: { emailVerifiedAt: true, username: true },
      }),
      this.prisma.store.findFirst({
        where: { id: input.storeId, status: 'ACTIVE' },
        select: { id: true, timezone: true },
      }),
      this.prisma.portalReportSchedule.findUnique({
        where: {
          portalUserId_storeId_frequency: {
            portalUserId: user.id,
            storeId: input.storeId,
            frequency: input.frequency,
          },
        },
        select: { enabled: true, nextRunAt: true },
      }),
    ]);
    if (!store) throw new BadRequestException('Store is not active.');
    if (input.enabled) {
      if (!this.validEmail(account.username) || !account.emailVerifiedAt) {
        throw new BadRequestException(
          'Verify the portal account email before enabling delivery.',
        );
      }
      if (!this.mailer.configured) {
        throw new ServiceUnavailableException(
          'Email delivery is not configured for this server.',
        );
      }
      if (!existing?.enabled) {
        const enabledCount = await this.prisma.portalReportSchedule.count({
          where: { portalUserId: user.id, enabled: true },
        });
        if (enabledCount >= 10) {
          throw new ConflictException(
            'A portal account can enable at most 10 report schedules.',
          );
        }
      }
    }
    const schedule = await this.prisma.portalReportSchedule.upsert({
      where: {
        portalUserId_storeId_frequency: {
          portalUserId: user.id,
          storeId: input.storeId,
          frequency: input.frequency,
        },
      },
      create: {
        portalUserId: user.id,
        storeId: input.storeId,
        frequency: input.frequency,
        enabled: input.enabled,
        nextRunAt: input.enabled
          ? this.nextRun(input.frequency, store.timezone)
          : null,
      },
      update: {
        enabled: input.enabled,
        nextRunAt: input.enabled
          ? existing?.enabled && existing.nextRunAt
            ? existing.nextRunAt
            : this.nextRun(input.frequency, store.timezone)
          : null,
      },
      select: {
        id: true,
        storeId: true,
        frequency: true,
        enabled: true,
        nextRunAt: true,
        lastAttemptAt: true,
        lastSuccessAt: true,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: input.enabled
          ? 'portal.report_schedule_enabled'
          : 'portal.report_schedule_disabled',
        resourceType: 'portal_report_schedule',
        resourceId: schedule.id,
        metadata: {
          portalUserId: user.id,
          storeId: input.storeId,
          frequency: input.frequency,
        },
      },
    });
    return schedule;
  }

  async requestEmailVerification(user: AuthenticatedPortalUser): Promise<void> {
    this.requireEnabled();
    const account = await this.prisma.portalUser.findUniqueOrThrow({
      where: { id: user.id },
      select: { username: true, emailVerifiedAt: true },
    });
    if (account.emailVerifiedAt) return;
    if (!this.validEmail(account.username)) {
      throw new BadRequestException(
        'The portal username must be an email address for scheduled reports.',
      );
    }
    if (!this.mailer.configured) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured for this server.',
      );
    }
    const recent = await this.prisma.portalEmailVerification.findFirst({
      where: {
        portalUserId: user.id,
        createdAt: { gt: new Date(Date.now() - 60_000) },
        usedAt: null,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (recent) {
      throw new ConflictException(
        'A verification code was sent recently. Wait before requesting another.',
      );
    }
    const code = String(randomInt(100_000, 1_000_000));
    const verification = await this.prisma.portalEmailVerification.create({
      data: {
        portalUserId: user.id,
        tokenHash: this.tokenHash(code),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });
    try {
      await this.mailer.send({
        to: account.username,
        subject: 'Verify scheduled report delivery',
        text: `Your VMJAM owner portal verification code is ${code}. It expires in 15 minutes.`,
        html: `<p>Your VMJAM owner portal verification code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 15 minutes.</p>`,
        idempotencyKey: `portal-email-verification/${verification.id}`,
      });
    } catch (error) {
      await this.prisma.portalEmailVerification.update({
        where: { id: verification.id },
        data: { revokedAt: new Date() },
      });
      throw error;
    }
  }

  async confirmEmailVerification(
    user: AuthenticatedPortalUser,
    code: string,
  ): Promise<void> {
    this.requireEnabled();
    const now = new Date();
    const verification = await this.prisma.portalEmailVerification.findFirst({
      where: {
        portalUserId: user.id,
        tokenHash: this.tokenHash(code),
        expiresAt: { gt: now },
        usedAt: null,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!verification) {
      throw new BadRequestException('Verification code is invalid or expired.');
    }
    await this.prisma.$transaction([
      this.prisma.portalEmailVerification.update({
        where: { id: verification.id },
        data: { usedAt: now },
      }),
      this.prisma.portalEmailVerification.updateMany({
        where: {
          portalUserId: user.id,
          id: { not: verification.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      }),
      this.prisma.portalUser.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now },
      }),
      this.prisma.auditLog.create({
        data: {
          action: 'portal.email_verified',
          resourceType: 'portal_user',
          resourceId: user.id,
          metadata: { portalUserId: user.id },
        },
      }),
    ]);
  }

  async processDueReports(): Promise<void> {
    if (!this.enabled) return;
    if (this.processing) return;
    this.processing = true;
    try {
      const now = new Date();
      await this.prisma.portalReportDelivery.updateMany({
        where: {
          status: 'PROCESSING',
          updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
          attemptCount: { lt: 3 },
        },
        data: {
          status: 'FAILED',
          nextAttemptAt: now,
          errorCode: 'DELIVERY_INTERRUPTED',
        },
      });
      const retries = await this.prisma.portalReportDelivery.findMany({
        where: {
          status: 'FAILED',
          attemptCount: { lt: 3 },
          nextAttemptAt: { lte: now },
        },
        include: {
          schedule: { include: { user: true, store: true } },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: 20,
      });
      for (const delivery of retries) await this.deliver(delivery);

      const schedules = await this.prisma.portalReportSchedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
        include: { user: true, store: true },
        orderBy: { nextRunAt: 'asc' },
        take: 25,
      });
      for (const schedule of schedules) {
        const period = this.reportPeriod(
          schedule.frequency,
          schedule.store.timezone,
          schedule.nextRunAt ?? now,
        );
        const delivery = await this.prisma.portalReportDelivery.upsert({
          where: {
            scheduleId_periodFrom_periodTo: {
              scheduleId: schedule.id,
              periodFrom: period.from,
              periodTo: period.to,
            },
          },
          create: {
            scheduleId: schedule.id,
            periodFrom: period.from,
            periodTo: period.to,
            recipientEmail: schedule.user.username,
          },
          update: {},
          include: {
            schedule: { include: { user: true, store: true } },
          },
        });
        await this.prisma.portalReportSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRunAt: this.nextRun(
              schedule.frequency,
              schedule.store.timezone,
              new Date(now.getTime() + 60_000),
            ),
          },
        });
        if (delivery.status === 'PENDING') await this.deliver(delivery);
      }
    } finally {
      this.processing = false;
    }
  }

  private async deliver(delivery: any): Promise<void> {
    const { schedule } = delivery;
    const now = new Date();
    const attemptCount = delivery.attemptCount + 1;
    const claim = await this.prisma.portalReportDelivery.updateMany({
      where: {
        id: delivery.id,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
      },
      data: { status: 'PROCESSING' },
    });
    if (!claim.count) return;
    if (
      !schedule.enabled ||
      schedule.user.status !== 'ACTIVE' ||
      !schedule.user.emailVerifiedAt ||
      !this.validEmail(schedule.user.username)
    ) {
      await this.prisma.portalReportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SKIPPED',
          attemptCount,
          nextAttemptAt: null,
          errorCode: 'RECIPIENT_NOT_VERIFIED',
        },
      });
      return;
    }
    const recentCount = await this.prisma.portalReportDelivery.count({
      where: {
        schedule: { portalUserId: schedule.portalUserId },
        createdAt: { gte: new Date(now.getTime() - 3_600_000) },
        attemptCount: { gt: 0 },
      },
    });
    if (recentCount > 10) {
      await this.prisma.portalReportDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'FAILED',
          errorCode: 'DELIVERY_RATE_LIMITED',
          nextAttemptAt: new Date(now.getTime() + 60 * 60_000),
        },
      });
      return;
    }
    try {
      const portalUser: AuthenticatedPortalUser = {
        id: schedule.user.id,
        sessionId: 'scheduled-report',
        clientId: schedule.user.clientId,
        username: schedule.user.username,
        displayName: schedule.user.displayName,
        role: schedule.user.role,
        storeIds: [schedule.storeId],
      };
      const report = await this.dashboard.overview(
        portalUser,
        schedule.storeId,
        { from: delivery.periodFrom, to: delivery.periodTo },
      );
      const summary = report.data as Record<string, any>;
      const snapshotAgeHours = Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(report.snapshotCreatedAt).getTime()) /
            3_600_000,
        ),
      );
      const dataQualityStatus = summary.profitDataComplete
        ? 'COMPLETE'
        : 'PARTIAL';
      const warning =
        snapshotAgeHours >= 24
          ? `Warning: synchronized data is ${snapshotAgeHours} hours old.`
          : null;
      const sendResult = await this.mailer.send({
        ...this.summaryMail(
          schedule.store.name,
          schedule.frequency,
          delivery.periodFrom,
          delivery.periodTo,
          snapshotAgeHours,
          dataQualityStatus,
          warning,
          summary,
          schedule.user.username,
        ),
        idempotencyKey: `scheduled-report/${delivery.id}`,
      });
      await this.prisma.$transaction([
        this.prisma.portalReportDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SENT',
            attemptCount,
            nextAttemptAt: null,
            snapshotAgeHours,
            dataQualityStatus,
            warning,
            errorCode: null,
            providerMessageId: sendResult.providerMessageId,
            providerStatus: 'email.sent',
            sentAt: now,
          },
        }),
        this.prisma.portalReportSchedule.update({
          where: { id: schedule.id },
          data: { lastAttemptAt: now, lastSuccessAt: now },
        }),
      ]);
    } catch {
      const retryMinutes = attemptCount === 1 ? 5 : 30;
      await this.prisma.$transaction([
        this.prisma.portalReportDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            attemptCount,
            nextAttemptAt:
              attemptCount < 3
                ? new Date(now.getTime() + retryMinutes * 60_000)
                : null,
            errorCode: 'REPORT_DELIVERY_FAILED',
          },
        }),
        this.prisma.portalReportSchedule.update({
          where: { id: schedule.id },
          data: { lastAttemptAt: now },
        }),
      ]);
    }
  }

  async handleResendWebhook(
    payload: string,
    headers: { id: string; timestamp: string; signature: string },
  ): Promise<void> {
    let event;
    try {
      event = this.mailer.verifyWebhook(payload, headers);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnauthorizedException('Resend webhook signature is invalid.');
    }
    const occurredAt = new Date(event.created_at);
    switch (event.type) {
      case 'email.sent':
        await this.prisma.$transaction([
          this.prisma.portalReportDelivery.updateMany({
            where: {
              providerMessageId: event.data.email_id,
              status: { in: ['SENT', 'PROCESSING'] },
            },
            data: { status: 'SENT', providerStatus: event.type },
          }),
          this.prisma.billingStatementDelivery.updateMany({
            where: {
              providerMessageId: event.data.email_id,
              status: { in: ['SENT', 'PROCESSING'] },
            },
            data: { status: 'SENT', providerStatus: event.type },
          }),
        ]);
        return;
      case 'email.delivery_delayed':
        await this.prisma.$transaction([
          this.prisma.portalReportDelivery.updateMany({
            where: {
              providerMessageId: event.data.email_id,
              status: { in: ['SENT', 'DELAYED'] },
            },
            data: { status: 'DELAYED', providerStatus: event.type },
          }),
          this.prisma.billingStatementDelivery.updateMany({
            where: {
              providerMessageId: event.data.email_id,
              status: { in: ['SENT', 'DELAYED'] },
            },
            data: { status: 'DELAYED', providerStatus: event.type },
          }),
        ]);
        return;
      case 'email.delivered':
        await this.prisma.$transaction([
          this.prisma.portalReportDelivery.updateMany({
            where: {
              providerMessageId: event.data.email_id,
              status: { notIn: ['BOUNCED', 'COMPLAINED'] },
            },
            data: {
              status: 'DELIVERED',
              providerStatus: event.type,
              deliveredAt: occurredAt,
              errorCode: null,
            },
          }),
          this.prisma.billingStatementDelivery.updateMany({
            where: {
              providerMessageId: event.data.email_id,
              status: { notIn: ['BOUNCED', 'COMPLAINED'] },
            },
            data: {
              status: 'DELIVERED',
              providerStatus: event.type,
              deliveredAt: occurredAt,
              errorCode: null,
            },
          }),
        ]);
        return;
      case 'email.bounced':
        await this.recordTerminalProviderFailure(
          event.data.email_id,
          'BOUNCED',
          event.type,
          'RESEND_BOUNCED',
        );
        return;
      case 'email.complained':
        await this.recordTerminalProviderFailure(
          event.data.email_id,
          'COMPLAINED',
          event.type,
          'RESEND_COMPLAINED',
        );
        return;
      case 'email.failed':
      case 'email.suppressed':
        await this.recordTerminalProviderFailure(
          event.data.email_id,
          'FAILED',
          event.type,
          event.type === 'email.failed'
            ? 'RESEND_DELIVERY_FAILED'
            : 'RESEND_SUPPRESSED',
        );
        return;
      default:
        return;
    }
  }

  private async recordTerminalProviderFailure(
    providerMessageId: string,
    status: 'BOUNCED' | 'COMPLAINED' | 'FAILED',
    providerStatus: string,
    errorCode: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.portalReportDelivery.updateMany({
        where: { providerMessageId },
        data: {
          status,
          providerStatus,
          errorCode,
          nextAttemptAt: null,
        },
      }),
      this.prisma.billingStatementDelivery.updateMany({
        where: { providerMessageId },
        data: { status, providerStatus, errorCode },
      }),
    ]);
  }

  private summaryMail(
    storeName: string,
    frequency: ReportFrequency,
    from: string,
    to: string,
    snapshotAgeHours: number,
    dataQualityStatus: string,
    warning: string | null,
    data: Record<string, any>,
    recipient: string,
  ) {
    const money = (value: unknown) =>
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
      }).format(Number(value ?? 0));
    const label = frequency === 'DAILY' ? 'Daily' : 'Weekly';
    const rows = [
      ['Gross sales', money(data.grossSales)],
      ['Transactions', String(data.transactionCount ?? 0)],
      ['Gross profit', money(data.grossProfit)],
      ['Customer balance', money(data.customerBalance)],
      ['Critical inventory', String(data.criticalItems ?? 0)],
      ['Transfers', String(data.transfers ?? 0)],
    ];
    const warningText = warning ? `\n${warning}\n` : '';
    const text = `${label} summary — ${storeName}\nPeriod: ${from} to ${to}\nSnapshot age: ${snapshotAgeHours} hours\nData quality: ${dataQualityStatus}${warningText}\n${rows.map(([name, value]) => `${name}: ${value}`).join('\n')}`;
    const htmlRows = rows
      .map(
        ([name, value]) =>
          `<tr><td style="padding:6px 12px 6px 0">${this.escape(name)}</td><td style="padding:6px 0;font-weight:700">${this.escape(value)}</td></tr>`,
      )
      .join('');
    const csv = [
      ['Store', storeName],
      ['Period from', from],
      ['Period to', to],
      ['Snapshot age hours', String(snapshotAgeHours)],
      ['Data quality', dataQualityStatus],
      ...rows,
    ]
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(','),
      )
      .join('\r\n');
    return {
      to: recipient,
      subject: `${warning ? '[STALE DATA] ' : ''}${label} summary — ${storeName}`,
      text,
      html: `<h2>${this.escape(storeName)} — ${label} summary</h2><p>Period: ${from} to ${to}<br>Snapshot age: ${snapshotAgeHours} hours<br>Data quality: <strong>${dataQualityStatus}</strong></p>${warning ? `<p style="padding:10px;background:#fff3cd;color:#664d03"><strong>${this.escape(warning)}</strong></p>` : ''}<table>${htmlRows}</table>`,
      attachments: [
        {
          filename: `${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${frequency.toLowerCase()}-${from}-to-${to}.csv`,
          content: `\uFEFF${csv}\r\n`,
          contentType: 'text/csv; charset=utf-8',
        },
      ],
    };
  }

  private reportPeriod(
    frequency: ReportFrequency,
    timezone: string,
    runAt: Date,
  ) {
    const localDate = this.localDate(runAt, timezone);
    const to = this.shiftDate(localDate, -1);
    return {
      from: frequency === 'DAILY' ? to : this.shiftDate(to, -6),
      to,
    };
  }

  private nextRun(
    frequency: ReportFrequency,
    timezone: string,
    after = new Date(),
  ): Date {
    let date = this.localDate(after, timezone);
    let candidate = this.zonedTimeToUtc(date, 7, timezone);
    if (candidate <= after) {
      date = this.shiftDate(date, 1);
      candidate = this.zonedTimeToUtc(date, 7, timezone);
    }
    if (frequency === 'WEEKLY') {
      while (this.isoWeekday(date) !== 1) {
        date = this.shiftDate(date, 1);
      }
      candidate = this.zonedTimeToUtc(date, 7, timezone);
    }
    return candidate;
  }

  private localDate(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }

  private zonedTimeToUtc(date: string, hour: number, timezone: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    const guess = Date.UTC(year, month - 1, day, hour);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const value = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const represented = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
    );
    return new Date(guess - (represented - guess));
  }

  private shiftDate(date: string, days: number): string {
    const shifted = new Date(`${date}T00:00:00.000Z`);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return shifted.toISOString().slice(0, 10);
  }

  private isoWeekday(date: string): number {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return day === 0 ? 7 : day;
  }

  private validEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private tokenHash(token: string): string {
    const secret = this.config.getOrThrow<string>('PORTAL_JWT_ACCESS_SECRET');
    return createHash('sha256').update(`${secret}:${token}`).digest('hex');
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Scheduled email reports are disabled on this server.',
      );
    }
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
