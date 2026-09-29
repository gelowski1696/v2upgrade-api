import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { WebAnalyticsBatchDto } from '../../presentation/http/analytics/web-analytics.dto.js';
import { WebAnalyticsService } from './web-analytics.service.js';

describe('WebAnalyticsService', () => {
  const prisma = {
    client: { findUnique: jest.fn() },
    webAnalyticsEvent: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const config = {
    get: jest.fn((key: string, fallback: unknown) =>
      key === 'WEB_ANALYTICS_RETENTION_DAYS' ? 90 : fallback,
    ),
  };
  const user: AuthenticatedPortalUser = {
    id: '10000000-0000-4000-8000-000000000001',
    sessionId: '10000000-0000-4000-8000-000000000002',
    clientId: '10000000-0000-4000-8000-000000000003',
    username: 'not-recorded@example.test',
    displayName: 'Not recorded',
    role: 'OWNER',
    storeIds: ['10000000-0000-4000-8000-000000000004'],
  };
  let service: WebAnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.webAnalyticsEvent.createMany.mockResolvedValue({ count: 1 });
    prisma.webAnalyticsEvent.deleteMany.mockResolvedValue({ count: 0 });
    service = new WebAnalyticsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  it('does not persist events when the tenant switch is disabled', async () => {
    prisma.client.findUnique.mockResolvedValue({ webAnalyticsEnabled: false });

    await expect(service.ingest(user, batch(), 'Browser')).resolves.toEqual({
      enabled: false,
      accepted: 0,
    });
    expect(prisma.webAnalyticsEvent.createMany).not.toHaveBeenCalled();
  });

  it('derives tenant, user, session, role, and coarse client context', async () => {
    prisma.client.findUnique.mockResolvedValue({ webAnalyticsEnabled: true });

    await expect(
      service.ingest(
        user,
        batch(),
        'Mozilla/5.0 (Windows NT 10.0) Edg/140.0 Safari/537.36',
      ),
    ).resolves.toEqual({ enabled: true, accepted: 1 });

    expect(prisma.webAnalyticsEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          clientId: user.clientId,
          portalUserId: user.id,
          portalSessionId: user.sessionId,
          portalRole: 'OWNER',
          storeId: user.storeIds[0],
          deviceClass: 'DESKTOP',
          browserFamily: 'EDGE',
          route: '/reports/overview',
        }),
      ],
      skipDuplicates: true,
    });
    const stored = prisma.webAnalyticsEvent.createMany.mock.calls[0][0].data[0];
    expect(stored).not.toHaveProperty('username');
    expect(stored).not.toHaveProperty('userAgent');
    expect(stored).not.toHaveProperty('ipAddress');
  });

  it('rejects store context outside the authenticated session', async () => {
    prisma.client.findUnique.mockResolvedValue({ webAnalyticsEnabled: true });
    const input = batch();
    input.events[0].storeId = '20000000-0000-4000-8000-000000000004';

    await expect(service.ingest(user, input, 'Browser')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.webAnalyticsEvent.createMany).not.toHaveBeenCalled();
  });
});

function batch(): WebAnalyticsBatchDto {
  return {
    events: [
      {
        eventId: '10000000-0000-4000-8000-000000000005',
        type: 'PAGE_VIEW',
        occurredAt: new Date().toISOString(),
        route: '/reports/overview',
        storeId: '10000000-0000-4000-8000-000000000004',
        appRelease: 'abc1234',
      },
    ],
  };
}
