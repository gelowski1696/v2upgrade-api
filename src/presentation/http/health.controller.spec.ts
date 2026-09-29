import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const config = {
    get: (key: string, fallback: string) =>
      ({ APP_VERSION: '1.2.3', APP_RELEASE: 'abc1234' })[key] ?? fallback,
  } as unknown as ConfigService;

  it('reports release metadata and database readiness', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      config,
    );

    await expect(controller.check()).resolves.toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'subsapi',
        version: '1.2.3',
        release: 'abc1234',
        checks: { database: 'ok' },
      }),
    );
  });

  it('keeps liveness independent from the database', () => {
    const controller = new HealthController({} as PrismaService, config);

    expect(controller.live()).toEqual(
      expect.objectContaining({
        status: 'ok',
        checks: { database: 'not_checked' },
      }),
    );
  });

  it('returns service unavailable when the database is down', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('connection failed')),
    };
    const controller = new HealthController(
      prisma as unknown as PrismaService,
      config,
    );

    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
