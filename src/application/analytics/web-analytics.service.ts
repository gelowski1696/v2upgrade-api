import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  type WebAnalyticsBatchDto,
  type WebAnalyticsEventDto,
  webAnalyticsEventTypes,
  webAnalyticsFeatures,
  webAnalyticsOperations,
  webVitalNames,
} from '../../presentation/http/analytics/web-analytics.dto.js';

const maximumEventAgeMs = 7 * 86_400_000;
const maximumFutureSkewMs = 5 * 60_000;

@Injectable()
export class WebAnalyticsService {
  private readonly logger = new Logger(WebAnalyticsService.name);
  private lastCleanupAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async configuration(user: AuthenticatedPortalUser) {
    const client = await this.prisma.client.findUnique({
      where: { id: user.clientId },
      select: { webAnalyticsEnabled: true },
    });
    return {
      enabled:
        this.config.get<boolean>('OWNER_WEB_ANALYTICS_ENABLED', true) &&
        client?.webAnalyticsEnabled === true,
      realUserMonitoringEnabled: this.config.get<boolean>(
        'OWNER_REAL_USER_MONITORING_ENABLED',
        true,
      ),
      maximumBatchSize: 25,
      retentionDays: this.retentionDays(),
      eventTypes: webAnalyticsEventTypes,
      features: webAnalyticsFeatures,
      operations: webAnalyticsOperations,
      webVitals: webVitalNames,
    };
  }

  async ingest(
    user: AuthenticatedPortalUser,
    input: WebAnalyticsBatchDto,
    userAgent = '',
  ) {
    const configuration = await this.configuration(user);
    if (!configuration.enabled) {
      return { enabled: false, accepted: 0 };
    }

    const now = Date.now();
    for (const event of input.events) this.validateEvent(event, user, now);
    const clientContext = classifyClient(userAgent);
    const result = await this.prisma.webAnalyticsEvent.createMany({
      data: input.events.map((event) => ({
        eventKey: event.eventId,
        eventType: event.type,
        clientId: user.clientId,
        storeId: event.storeId ?? null,
        portalUserId: user.id,
        portalSessionId: user.sessionId,
        portalRole: user.role,
        occurredAt: new Date(event.occurredAt),
        route: event.route,
        feature: event.feature ?? null,
        operation: event.operation ?? null,
        errorCode: event.errorCode ?? null,
        httpStatus: event.httpStatus ?? null,
        metricName: event.metricName ?? null,
        metricValue: event.metricValue ?? null,
        appRelease: event.appRelease,
        ...clientContext,
      })),
      skipDuplicates: true,
    });
    await this.cleanupExpiredEvents().catch(() => {
      this.logger.error(
        JSON.stringify({ event: 'analytics.retention_failed' }),
      );
    });
    return { enabled: true, accepted: result.count };
  }

  private validateEvent(
    event: WebAnalyticsEventDto,
    user: AuthenticatedPortalUser,
    now: number,
  ): void {
    const occurredAt = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAt)) {
      throw new BadRequestException('Event occurrence time is invalid.');
    }
    if (
      occurredAt < now - maximumEventAgeMs ||
      occurredAt > now + maximumFutureSkewMs
    ) {
      throw new BadRequestException(
        'Analytics event time is outside the accepted window.',
      );
    }
    if (event.storeId && !user.storeIds.includes(event.storeId)) {
      throw new BadRequestException('Analytics store context is invalid.');
    }
    if (event.type === 'FEATURE_USED' && !event.feature) {
      throw new BadRequestException(
        'Feature events require an allowlisted feature.',
      );
    }
    if (event.type === 'FRONTEND_ERROR' && !event.errorCode) {
      throw new BadRequestException(
        'Frontend error events require a safe error code.',
      );
    }
    if (
      event.type === 'API_FAILURE' &&
      (!event.operation || !event.errorCode || !event.httpStatus)
    ) {
      throw new BadRequestException(
        'API failure events require an operation, status, and error code.',
      );
    }
    if (event.type === 'WEB_VITAL') this.validateWebVital(event);
  }

  private validateWebVital(event: WebAnalyticsEventDto): void {
    if (
      !event.metricName ||
      event.metricValue === undefined ||
      event.metricValue < 0
    ) {
      throw new BadRequestException(
        'Web vital events require a valid metric and value.',
      );
    }
    const maximum = event.metricName === 'CLS' ? 10 : 120_000;
    if (event.metricValue > maximum) {
      throw new BadRequestException(
        'Web vital value is outside the accepted range.',
      );
    }
  }

  private retentionDays(): number {
    return this.config.get<number>('WEB_ANALYTICS_RETENTION_DAYS', 90);
  }

  private async cleanupExpiredEvents(): Promise<void> {
    if (Date.now() - this.lastCleanupAt < 60 * 60_000) return;
    this.lastCleanupAt = Date.now();
    const cutoff = new Date(Date.now() - this.retentionDays() * 86_400_000);
    const result = await this.prisma.webAnalyticsEvent.deleteMany({
      where: { occurredAt: { lt: cutoff } },
    });
    if (result.count) {
      this.logger.log(
        JSON.stringify({
          event: 'analytics.retention_deleted',
          count: result.count,
        }),
      );
    }
  }
}

function classifyClient(userAgent: string) {
  const normalized = userAgent.toLowerCase();
  const deviceClass = /ipad|tablet|android(?!.*mobile)/.test(normalized)
    ? 'TABLET'
    : /mobile|iphone|ipod|android/.test(normalized)
      ? 'MOBILE'
      : normalized
        ? 'DESKTOP'
        : 'UNKNOWN';
  const browserFamily = /edg\//.test(normalized)
    ? 'EDGE'
    : /firefox\//.test(normalized)
      ? 'FIREFOX'
      : /chrome\//.test(normalized)
        ? 'CHROME'
        : /safari\//.test(normalized)
          ? 'SAFARI'
          : 'OTHER';
  return { deviceClass, browserFamily } as const;
}
