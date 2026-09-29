import { validateEnvironment } from './environment.js';

const validEnvironment = {
  DATABASE_URL:
    'postgresql://postgres:password@localhost:5432/posv2_subscription',
  JWT_ACCESS_SECRET: 'access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
  DEVICE_JWT_SECRET: 'device-secret-with-at-least-32-characters',
  PORTAL_JWT_ACCESS_SECRET: 'portal-secret-with-at-least-32-characters',
};

describe('validateEnvironment', () => {
  it('applies operational defaults', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3100,
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL_DAYS: 30,
      LICENSE_LEASE_DAYS: 7,
      PORTAL_PASSWORD_RESET_TTL_MINUTES: 60,
      PORTAL_REFRESH_REUSE_GRACE_SECONDS: 5,
      STORE_SNAPSHOT_RETAIN_PREVIOUS: 2,
      PORTAL_SCHEDULED_REPORTS_ENABLED: false,
    });
  });

  it('rejects a non-PostgreSQL connection string', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        DATABASE_URL: 'sqlite://data.db',
      }),
    ).toThrow('DATABASE_URL must be a PostgreSQL connection string.');
  });

  it('rejects weak token secrets', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, JWT_ACCESS_SECRET: 'short' }),
    ).toThrow('JWT_ACCESS_SECRET must contain at least 32 characters.');
  });

  it('rejects an unsafe refresh reuse grace period', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        PORTAL_REFRESH_REUSE_GRACE_SECONDS: 0,
      }),
    ).toThrow(
      'PORTAL_REFRESH_REUSE_GRACE_SECONDS must be an integer from 1 to 30.',
    );
  });

  it('rejects an invalid snapshot retention count', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        STORE_SNAPSHOT_RETAIN_PREVIOUS: -1,
      }),
    ).toThrow('STORE_SNAPSHOT_RETAIN_PREVIOUS must be a non-negative integer.');
  });

  it('rejects an invalid portal password reset duration', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        PORTAL_PASSWORD_RESET_TTL_MINUTES: 0,
      }),
    ).toThrow('PORTAL_PASSWORD_RESET_TTL_MINUTES must be a positive integer.');
  });

  it('accepts an explicit scheduled-report worker switch', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        PORTAL_SCHEDULED_REPORTS_ENABLED: 'true',
      }),
    ).toMatchObject({ PORTAL_SCHEDULED_REPORTS_ENABLED: true });

    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        PORTAL_SCHEDULED_REPORTS_ENABLED: 'sometimes',
      }),
    ).toThrow('PORTAL_SCHEDULED_REPORTS_ENABLED must be true or false.');
  });
});
