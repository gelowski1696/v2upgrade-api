import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WebAnalyticsBatchDto } from './web-analytics.dto.js';

describe('WebAnalyticsBatchDto', () => {
  it('accepts a privacy-minimized normalized page event', async () => {
    const errors = await validateBatch({
      events: [event({ route: '/reports/overview' })],
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects query strings and unknown free-form event fields', async () => {
    const errors = await validateBatch({
      events: [
        event({
          route: '/reports/sales?customer=private',
          message: 'A free-form error containing private data',
        }),
      ],
    });

    expect(errors.length).toBeGreaterThan(0);
  });
});

function event(overrides: Record<string, unknown>) {
  return {
    eventId: '10000000-0000-4000-8000-000000000005',
    type: 'PAGE_VIEW',
    occurredAt: new Date().toISOString(),
    route: '/',
    appRelease: 'abc1234',
    ...overrides,
  };
}

async function validateBatch(input: object) {
  return validate(plainToInstance(WebAnalyticsBatchDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
