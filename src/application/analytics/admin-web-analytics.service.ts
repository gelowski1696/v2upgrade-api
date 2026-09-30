import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client.js';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import type { AuthenticatedUser } from '../../domain/auth/auth.types.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AdminWebAnalyticsQueryDto } from '../../presentation/http/analytics/admin-web-analytics.dto.js';

type Numeric = bigint | number | string;

interface SummaryRow {
  activeUsers: Numeric;
  sessions: Numeric;
  pageViews: Numeric;
  frontendErrors: Numeric;
  apiFailures: Numeric;
  affectedSessions: Numeric;
  activeClients: Numeric;
  enabledClients: Numeric;
  latestEventAt: Date | null;
  latestWebRelease: string | null;
}

interface UsageRow {
  day: Date;
  activeUsers: Numeric;
  sessions: Numeric;
  pageViews: Numeric;
}

interface NamedCountRow {
  name: string;
  count: Numeric;
}

interface PerformanceRow {
  route: string;
  metricName: string;
  deviceClass: string;
  sampleCount: Numeric;
  p75: Numeric;
}

interface ErrorRow {
  eventType: string;
  errorCode: string;
  appRelease: string;
  count: Numeric;
  affectedSessions: Numeric;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

@Injectable()
export class AdminWebAnalyticsService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    private readonly config: ConfigService,
  ) {}

  async filters(user: AuthenticatedUser) {
    this.assertViewEnabled();
    const clients = await this.prisma.client.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { businessName: 'asc' },
      select: {
        id: true,
        code: true,
        businessName: true,
        stores: {
          where: { status: 'ACTIVE' },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true },
        },
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'WEB_ANALYTICS_FILTERS_VIEWED',
      resourceType: 'WEB_ANALYTICS',
    });
    return { generatedAt: new Date().toISOString(), clients };
  }

  async overview(user: AuthenticatedUser, query: AdminWebAnalyticsQueryDto) {
    this.assertViewEnabled();
    const range = this.range(query);
    const scope = this.scopeSql(range.fromDate, range.toExclusive, query);

    const [
      summaryRows,
      usageRows,
      routeRows,
      featureRows,
      performanceRows,
      errorRows,
    ] = await Promise.all([
      this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
          SELECT
            COUNT(DISTINCT "portal_user_id") AS "activeUsers",
            COUNT(DISTINCT "portal_session_id") AS "sessions",
            COUNT(*) FILTER (WHERE "event_type" = 'PAGE_VIEW') AS "pageViews",
            COUNT(*) FILTER (WHERE "event_type" = 'FRONTEND_ERROR') AS "frontendErrors",
            COUNT(*) FILTER (WHERE "event_type" = 'API_FAILURE') AS "apiFailures",
            COUNT(DISTINCT "portal_session_id") FILTER (
              WHERE "event_type" IN ('FRONTEND_ERROR', 'API_FAILURE')
            ) AS "affectedSessions",
            (SELECT COUNT(*) FROM "clients" WHERE "status" = 'ACTIVE') AS "activeClients",
            (SELECT COUNT(*) FROM "clients"
              WHERE "status" = 'ACTIVE' AND "web_analytics_enabled" = TRUE
            ) AS "enabledClients",
            MAX("occurred_at") AS "latestEventAt",
            (ARRAY_AGG("app_release" ORDER BY "occurred_at" DESC))[1] AS "latestWebRelease"
          FROM "web_analytics_events"
          WHERE ${scope}
        `),
      this.prisma.$queryRaw<UsageRow[]>(Prisma.sql`
          SELECT
            DATE_TRUNC('day', "occurred_at") AS "day",
            COUNT(DISTINCT "portal_user_id") AS "activeUsers",
            COUNT(DISTINCT "portal_session_id") AS "sessions",
            COUNT(*) FILTER (WHERE "event_type" = 'PAGE_VIEW') AS "pageViews"
          FROM "web_analytics_events"
          WHERE ${scope}
          GROUP BY 1
          ORDER BY 1
        `),
      this.prisma.$queryRaw<NamedCountRow[]>(Prisma.sql`
          SELECT "route" AS "name", COUNT(*) AS "count"
          FROM "web_analytics_events"
          WHERE ${scope} AND "event_type" = 'PAGE_VIEW'
          GROUP BY "route"
          HAVING COUNT(DISTINCT "portal_user_id") >= 3
          ORDER BY "count" DESC, "route"
          LIMIT 10
        `),
      this.prisma.$queryRaw<NamedCountRow[]>(Prisma.sql`
          SELECT "feature" AS "name", COUNT(*) AS "count"
          FROM "web_analytics_events"
          WHERE ${scope} AND "event_type" = 'FEATURE_USED' AND "feature" IS NOT NULL
          GROUP BY "feature"
          HAVING COUNT(DISTINCT "portal_user_id") >= 3
          ORDER BY "count" DESC, "feature"
          LIMIT 10
        `),
      this.prisma.$queryRaw<PerformanceRow[]>(Prisma.sql`
          SELECT
            "route",
            "metric_name"::text AS "metricName",
            "device_class"::text AS "deviceClass",
            COUNT(*) AS "sampleCount",
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY "metric_value") AS "p75"
          FROM "web_analytics_events"
          WHERE ${scope} AND "event_type" = 'WEB_VITAL' AND "metric_value" IS NOT NULL
          GROUP BY "route", "metric_name", "device_class"
          HAVING COUNT(DISTINCT "portal_user_id") >= 3
          ORDER BY "sampleCount" DESC, "route"
          LIMIT 50
        `),
      this.prisma.$queryRaw<ErrorRow[]>(Prisma.sql`
          SELECT
            "event_type"::text AS "eventType",
            COALESCE("error_code", 'UNKNOWN') AS "errorCode",
            "app_release" AS "appRelease",
            COUNT(*) AS "count",
            COUNT(DISTINCT "portal_session_id") AS "affectedSessions",
            MIN("occurred_at") AS "firstSeenAt",
            MAX("occurred_at") AS "lastSeenAt"
          FROM "web_analytics_events"
          WHERE ${scope} AND "event_type" IN ('FRONTEND_ERROR', 'API_FAILURE')
          GROUP BY "event_type", "error_code", "app_release"
          HAVING COUNT(DISTINCT "portal_session_id") >= 3
          ORDER BY "count" DESC, "lastSeenAt" DESC
          LIMIT 25
        `),
    ]);

    const summary = summaryRows[0] ?? {
      activeUsers: 0,
      sessions: 0,
      pageViews: 0,
      frontendErrors: 0,
      apiFailures: 0,
      affectedSessions: 0,
      activeClients: 0,
      enabledClients: 0,
      latestEventAt: null,
      latestWebRelease: null,
    };
    const sessions = count(summary.sessions);
    const affectedSessions = count(summary.affectedSessions);
    const activeUsers = count(summary.activeUsers);
    const activeClients = count(summary.activeClients);
    const enabledClients = count(summary.enabledClients);
    const collectionGloballyEnabled = this.config.get<boolean>(
      'OWNER_WEB_ANALYTICS_ENABLED',
      true,
    );
    const collectionState =
      !collectionGloballyEnabled || enabledClients === 0
        ? 'DISABLED'
        : enabledClients < activeClients
          ? 'PARTIAL'
          : 'ACTIVE';
    const breakdownsSuppressed = activeUsers > 0 && activeUsers < 3;

    await this.audit.record({
      actorId: user.id,
      action: 'WEB_ANALYTICS_OVERVIEW_VIEWED',
      resourceType: 'WEB_ANALYTICS',
      metadata: {
        from: range.from,
        to: range.to,
        clientId: query.clientId ?? null,
        storeId: query.storeId ?? null,
      },
    });

    return {
      range: { from: range.from, to: range.to, timezone: 'UTC' },
      scope: {
        clientId: query.clientId ?? null,
        storeId: query.storeId ?? null,
      },
      generatedAt: new Date().toISOString(),
      metricVersion: '1.0',
      environment: this.config.get<string>('NODE_ENV', 'development'),
      health: {
        status: 'OPERATIONAL' as const,
        api: {
          version: this.config.get<string>('APP_VERSION', '0.0.1'),
          release: this.config.get<string>('APP_RELEASE', 'development'),
          uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
          database: 'AVAILABLE' as const,
        },
        ownerDashboard: {
          observedRelease: summary.latestWebRelease,
          latestSignalAt: summary.latestEventAt?.toISOString() ?? null,
        },
        historicalAvailabilityAvailable: false,
      },
      collection: {
        state: collectionState,
        activeClients,
        enabledClients,
        realUserMonitoringEnabled: this.config.get<boolean>(
          'OWNER_REAL_USER_MONITORING_ENABLED',
          true,
        ),
        retentionDays: this.config.get<number>(
          'WEB_ANALYTICS_RETENTION_DAYS',
          90,
        ),
      },
      privacy: {
        minimumGroupSize: 3,
        breakdownsSuppressed,
      },
      summary: {
        activeUsers,
        sessions,
        pageViews: count(summary.pageViews),
        frontendErrors: count(summary.frontendErrors),
        apiFailures: count(summary.apiFailures),
        affectedSessions,
        affectedSessionRate: sessions
          ? round((affectedSessions / sessions) * 100, 2)
          : 0,
      },
      usage: usageRows.map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        activeUsers: count(row.activeUsers),
        sessions: count(row.sessions),
        pageViews: count(row.pageViews),
      })),
      routes: breakdownsSuppressed ? [] : routeRows.map(namedCount),
      features: breakdownsSuppressed ? [] : featureRows.map(namedCount),
      performance: breakdownsSuppressed
        ? []
        : performanceRows.map((row) => {
            const sampleCount = count(row.sampleCount);
            return {
              route: row.route,
              metricName: row.metricName,
              deviceClass: row.deviceClass,
              sampleCount,
              p75: round(Number(row.p75), row.metricName === 'CLS' ? 4 : 0),
              insufficientSample: sampleCount < 20,
            };
          }),
      errors: (breakdownsSuppressed ? [] : errorRows).map((row) => ({
        eventType: row.eventType,
        errorCode: row.errorCode,
        appRelease: row.appRelease,
        count: count(row.count),
        affectedSessions: count(row.affectedSessions),
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
    };
  }

  private assertViewEnabled(): void {
    if (!this.config.get<boolean>('ADMIN_WEB_ANALYTICS_VIEW_ENABLED', true)) {
      throw new ForbiddenException('Website analytics reporting is disabled.');
    }
  }

  private range(query: AdminWebAnalyticsQueryDto) {
    const today = new Date();
    const to = query.to ?? today.toISOString().slice(0, 10);
    const toDate = isoDate(to);
    const defaultFrom = new Date(toDate);
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
    const from = query.from ?? defaultFrom.toISOString().slice(0, 10);
    const fromDate = isoDate(from);
    const toExclusive = new Date(toDate);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    const days =
      Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (days < 1 || days > 90) {
      throw new BadRequestException(
        'Analytics range must be between 1 and 90 days.',
      );
    }
    return { from, to, fromDate, toExclusive };
  }

  private scopeSql(
    from: Date,
    toExclusive: Date,
    query: AdminWebAnalyticsQueryDto,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"occurred_at" >= ${from}`,
      Prisma.sql`"occurred_at" < ${toExclusive}`,
    ];
    if (query.clientId)
      conditions.push(Prisma.sql`"client_id" = ${query.clientId}::uuid`);
    if (query.storeId)
      conditions.push(Prisma.sql`"store_id" = ${query.storeId}::uuid`);
    return Prisma.join(conditions, ' AND ');
  }
}

function isoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Analytics dates must use YYYY-MM-DD.');
  }
  return parsed;
}

function count(value: Numeric): number {
  return Number(value ?? 0);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function namedCount(row: NamedCountRow) {
  return { name: row.name, count: count(row.count) };
}
