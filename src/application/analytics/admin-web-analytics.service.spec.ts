import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { AuditWriter } from '../../domain/audit/audit-writer.js';
import type { AuthenticatedUser } from '../../domain/auth/auth.types.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AdminWebAnalyticsService } from './admin-web-analytics.service.js';

describe('AdminWebAnalyticsService', () => {
  const config = {
    get: jest.fn(
      (key: string, fallback: unknown) =>
        ({
          NODE_ENV: 'production',
          APP_VERSION: '1.2.3',
          APP_RELEASE: 'api1234',
          OWNER_WEB_ANALYTICS_ENABLED: true,
          OWNER_REAL_USER_MONITORING_ENABLED: true,
          ADMIN_WEB_ANALYTICS_VIEW_ENABLED: true,
          WEB_ANALYTICS_RETENTION_DAYS: 90,
        })[key] ?? fallback,
    ),
  } as unknown as ConfigService;
  const user: AuthenticatedUser = {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'administrator',
    displayName: 'Administrator',
    role: 'SUPER_ADMIN',
  };

  it('returns privacy-safe aggregates and audits the cross-client query', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          activeUsers: 3n,
          sessions: 4n,
          pageViews: 12n,
          frontendErrors: 2n,
          apiFailures: 1n,
          affectedSessions: 2n,
          activeClients: 2n,
          enabledClients: 1n,
          latestEventAt: new Date('2026-09-29T02:00:00.000Z'),
          latestWebRelease: 'web1234',
        },
      ])
      .mockResolvedValueOnce([
        {
          day: new Date('2026-09-29T00:00:00.000Z'),
          activeUsers: 3n,
          sessions: 4n,
          pageViews: 12n,
        },
      ])
      .mockResolvedValueOnce([{ name: '/dashboard/sales', count: 8n }])
      .mockResolvedValueOnce([{ name: 'REPORT_OPENED', count: 7n }])
      .mockResolvedValueOnce([
        {
          route: '/dashboard/sales',
          metricName: 'LCP',
          deviceClass: 'DESKTOP',
          sampleCount: 12n,
          p75: 1800.4,
        },
      ])
      .mockResolvedValueOnce([
        {
          eventType: 'FRONTEND_ERROR',
          errorCode: 'UNHANDLED_FRONTEND_ERROR',
          appRelease: 'abc1234',
          count: 2n,
          affectedSessions: 3n,
          firstSeenAt: new Date('2026-09-29T01:00:00.000Z'),
          lastSeenAt: new Date('2026-09-29T02:00:00.000Z'),
        },
      ]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };
    const service = new AdminWebAnalyticsService(prisma, audit, config);

    const result = await service.overview(user, {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(result.summary).toEqual({
      activeUsers: 3,
      sessions: 4,
      pageViews: 12,
      frontendErrors: 2,
      apiFailures: 1,
      affectedSessions: 2,
      affectedSessionRate: 50,
    });
    expect(result.performance[0]).toEqual(
      expect.objectContaining({
        p75: 1800,
        sampleCount: 12,
        insufficientSample: true,
      }),
    );
    expect(result.health.status).toBe('OPERATIONAL');
    expect(result.health.ownerDashboard.observedRelease).toBe('web1234');
    expect(result.collection).toEqual(
      expect.objectContaining({ state: 'PARTIAL', enabledClients: 1 }),
    );
    expect(result.errors[0]).not.toHaveProperty('portalUserId');
    expect(result.errors[0]).not.toHaveProperty('username');
    expect(queryRaw).toHaveBeenCalledTimes(6);
    expect(audit.record.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        actorId: user.id,
        action: 'WEB_ANALYTICS_OVERVIEW_VIEWED',
      }),
    );
  });

  it('rejects invalid and oversized ranges before querying analytics', async () => {
    const queryRaw = jest.fn();
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };
    const service = new AdminWebAnalyticsService(prisma, audit, config);

    await expect(
      service.overview(user, { from: '2026-02-31', to: '2026-03-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.overview(user, { from: '2026-02-01', to: '2026-02-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.overview(user, { from: '2026-01-01', to: '2026-09-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(audit.record.mock.calls).toHaveLength(0);
  });

  it('returns active client and store filter labels without user data', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: '10000000-0000-4000-8000-000000000010',
        code: 'CLIENT',
        businessName: 'Example Business',
        stores: [
          {
            id: '10000000-0000-4000-8000-000000000011',
            code: 'MAIN',
            name: 'Main Store',
          },
        ],
      },
    ]);
    const prisma = { client: { findMany } } as unknown as PrismaService;
    const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };
    const service = new AdminWebAnalyticsService(prisma, audit, config);

    const result = await service.filters(user);

    expect(result.clients[0]).not.toHaveProperty('ownerName');
    expect(result.clients[0]).not.toHaveProperty('email');
    expect(audit.record.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ action: 'WEB_ANALYTICS_FILTERS_VIEWED' }),
    );
  });

  it('suppresses detailed groups below the privacy threshold', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([
        {
          activeUsers: 1n,
          sessions: 1n,
          pageViews: 2n,
          frontendErrors: 0n,
          apiFailures: 0n,
          affectedSessions: 0n,
          activeClients: 1n,
          enabledClients: 1n,
          latestEventAt: new Date('2026-09-29T02:00:00.000Z'),
          latestWebRelease: 'web1234',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: '/dashboard/sales', count: 2n }])
      .mockResolvedValueOnce([{ name: 'REPORT_OPENED', count: 2n }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };
    const service = new AdminWebAnalyticsService(prisma, audit, config);

    const result = await service.overview(user, {
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(result.privacy.breakdownsSuppressed).toBe(true);
    expect(result.routes).toEqual([]);
    expect(result.features).toEqual([]);
    expect(result.performance).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('enforces the administrator analytics view switch in the API', async () => {
    const findMany = jest.fn();
    const prisma = { client: { findMany } } as unknown as PrismaService;
    const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };
    const disabledConfig = {
      get: (key: string, fallback: unknown) =>
        key === 'ADMIN_WEB_ANALYTICS_VIEW_ENABLED' ? false : fallback,
    } as unknown as ConfigService;
    const service = new AdminWebAnalyticsService(prisma, audit, disabledConfig);

    await expect(service.filters(user)).rejects.toThrow(
      'Website analytics reporting is disabled.',
    );
    expect(findMany).not.toHaveBeenCalled();
    expect(audit.record.mock.calls).toHaveLength(0);
  });
});
