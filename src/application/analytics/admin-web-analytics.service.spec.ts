import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuditWriter } from '../../domain/audit/audit-writer.js';
import type { AuthenticatedUser } from '../../domain/auth/auth.types.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AdminWebAnalyticsService } from './admin-web-analytics.service.js';

describe('AdminWebAnalyticsService', () => {
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
          affectedSessions: 2n,
          firstSeenAt: new Date('2026-09-29T01:00:00.000Z'),
          lastSeenAt: new Date('2026-09-29T02:00:00.000Z'),
        },
      ]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };
    const service = new AdminWebAnalyticsService(prisma, audit);

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
    expect(result.errors[0]).not.toHaveProperty('portalUserId');
    expect(result.errors[0]).not.toHaveProperty('username');
    expect(queryRaw).toHaveBeenCalledTimes(6);
    expect(audit.record).toHaveBeenCalledWith(
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
    const service = new AdminWebAnalyticsService(prisma, audit);

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
    expect(audit.record).not.toHaveBeenCalled();
  });
});
