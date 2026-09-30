type Environment = Record<string, unknown>;

const requiredSecrets = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'DEVICE_JWT_SECRET',
  'PORTAL_JWT_ACCESS_SECRET',
] as const;

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : fallback;
}

function booleanValue(
  value: unknown,
  fallback: boolean,
  name: string,
): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  if (value.trim().toLowerCase() === 'true') return true;
  if (value.trim().toLowerCase() === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

export function validateEnvironment(config: Environment): Environment {
  const nodeEnv = stringValue(config.NODE_ENV, 'development');
  const databaseUrl = stringValue(config.DATABASE_URL);

  if (
    !databaseUrl.startsWith('postgresql://') &&
    !databaseUrl.startsWith('postgres://')
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string.');
  }

  for (const key of requiredSecrets) {
    const value = stringValue(config[key]);
    if (value.length < 32) {
      throw new Error(`${key} must contain at least 32 characters.`);
    }
  }

  const port = numberValue(config.PORT, 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  const retainedPreviousSnapshots = numberValue(
    config.STORE_SNAPSHOT_RETAIN_PREVIOUS,
    2,
  );
  if (
    !Number.isInteger(retainedPreviousSnapshots) ||
    retainedPreviousSnapshots < 0
  ) {
    throw new Error(
      'STORE_SNAPSHOT_RETAIN_PREVIOUS must be a non-negative integer.',
    );
  }
  const portalPasswordResetMinutes = numberValue(
    config.PORTAL_PASSWORD_RESET_TTL_MINUTES,
    60,
  );
  if (
    !Number.isInteger(portalPasswordResetMinutes) ||
    portalPasswordResetMinutes < 1
  ) {
    throw new Error(
      'PORTAL_PASSWORD_RESET_TTL_MINUTES must be a positive integer.',
    );
  }
  const portalRefreshReuseGraceSeconds = numberValue(
    config.PORTAL_REFRESH_REUSE_GRACE_SECONDS,
    5,
  );
  const adminRememberLoginDays = numberValue(
    config.ADMIN_REMEMBER_LOGIN_TTL_DAYS,
    30,
  );
  if (
    !Number.isInteger(adminRememberLoginDays) ||
    adminRememberLoginDays < 1 ||
    adminRememberLoginDays > 90
  ) {
    throw new Error(
      'ADMIN_REMEMBER_LOGIN_TTL_DAYS must be an integer from 1 to 90.',
    );
  }
  const adminBrowserSessionHours = numberValue(
    config.ADMIN_BROWSER_SESSION_TTL_HOURS,
    24,
  );
  if (
    !Number.isInteger(adminBrowserSessionHours) ||
    adminBrowserSessionHours < 1 ||
    adminBrowserSessionHours > 168
  ) {
    throw new Error(
      'ADMIN_BROWSER_SESSION_TTL_HOURS must be an integer from 1 to 168.',
    );
  }
  const adminRefreshReuseGraceSeconds = numberValue(
    config.ADMIN_REFRESH_REUSE_GRACE_SECONDS,
    5,
  );
  if (
    !Number.isInteger(adminRefreshReuseGraceSeconds) ||
    adminRefreshReuseGraceSeconds < 1 ||
    adminRefreshReuseGraceSeconds > 30
  ) {
    throw new Error(
      'ADMIN_REFRESH_REUSE_GRACE_SECONDS must be an integer from 1 to 30.',
    );
  }
  const webAnalyticsRetentionDays = numberValue(
    config.WEB_ANALYTICS_RETENTION_DAYS,
    90,
  );
  if (
    !Number.isInteger(webAnalyticsRetentionDays) ||
    webAnalyticsRetentionDays < 1 ||
    webAnalyticsRetentionDays > 365
  ) {
    throw new Error(
      'WEB_ANALYTICS_RETENTION_DAYS must be an integer from 1 to 365.',
    );
  }
  if (
    !Number.isInteger(portalRefreshReuseGraceSeconds) ||
    portalRefreshReuseGraceSeconds < 1 ||
    portalRefreshReuseGraceSeconds > 30
  ) {
    throw new Error(
      'PORTAL_REFRESH_REUSE_GRACE_SECONDS must be an integer from 1 to 30.',
    );
  }
  return {
    ...config,
    NODE_ENV: nodeEnv,
    PORT: port,
    ACCESS_TOKEN_TTL: stringValue(config.ACCESS_TOKEN_TTL, '15m'),
    REFRESH_TOKEN_TTL_DAYS: numberValue(config.REFRESH_TOKEN_TTL_DAYS, 30),
    ADMIN_REMEMBER_LOGIN_TTL_DAYS: adminRememberLoginDays,
    ADMIN_BROWSER_SESSION_TTL_HOURS: adminBrowserSessionHours,
    ADMIN_REFRESH_REUSE_GRACE_SECONDS: adminRefreshReuseGraceSeconds,
    LICENSE_LEASE_DAYS: numberValue(config.LICENSE_LEASE_DAYS, 7),
    DEVICE_TOKEN_TTL: stringValue(config.DEVICE_TOKEN_TTL, '12h'),
    PORTAL_ACCESS_TOKEN_TTL: stringValue(config.PORTAL_ACCESS_TOKEN_TTL, '15m'),
    PORTAL_REFRESH_TOKEN_TTL_DAYS: numberValue(
      config.PORTAL_REFRESH_TOKEN_TTL_DAYS,
      30,
    ),
    PORTAL_PASSWORD_RESET_TTL_MINUTES: portalPasswordResetMinutes,
    PORTAL_REFRESH_REUSE_GRACE_SECONDS: portalRefreshReuseGraceSeconds,
    WEB_ANALYTICS_RETENTION_DAYS: webAnalyticsRetentionDays,
    STORE_SNAPSHOT_ROOT: stringValue(config.STORE_SNAPSHOT_ROOT, './data'),
    STORE_SNAPSHOT_MAX_BYTES: numberValue(
      config.STORE_SNAPSHOT_MAX_BYTES,
      512 * 1024 * 1024,
    ),
    STORE_SNAPSHOT_RETAIN_PREVIOUS: retainedPreviousSnapshots,
    STORE_SCHEMA_MIN_VERSION: numberValue(config.STORE_SCHEMA_MIN_VERSION, 27),
    STORE_SCHEMA_MAX_VERSION: numberValue(config.STORE_SCHEMA_MAX_VERSION, 27),
    STORE_CLIENT_CACHE_MAX: numberValue(config.STORE_CLIENT_CACHE_MAX, 25),
    STORE_CLIENT_IDLE_MILLISECONDS: numberValue(
      config.STORE_CLIENT_IDLE_MILLISECONDS,
      10 * 60_000,
    ),
    RESEND_API_KEY: stringValue(config.RESEND_API_KEY),
    RESEND_FROM_EMAIL: stringValue(config.RESEND_FROM_EMAIL),
    RESEND_WEBHOOK_SECRET: stringValue(config.RESEND_WEBHOOK_SECRET),
    PORTAL_SCHEDULED_REPORTS_ENABLED: booleanValue(
      config.PORTAL_SCHEDULED_REPORTS_ENABLED,
      false,
      'PORTAL_SCHEDULED_REPORTS_ENABLED',
    ),
    OWNER_WEB_ANALYTICS_ENABLED: booleanValue(
      config.OWNER_WEB_ANALYTICS_ENABLED,
      true,
      'OWNER_WEB_ANALYTICS_ENABLED',
    ),
    OWNER_REAL_USER_MONITORING_ENABLED: booleanValue(
      config.OWNER_REAL_USER_MONITORING_ENABLED,
      true,
      'OWNER_REAL_USER_MONITORING_ENABLED',
    ),
    ADMIN_WEB_ANALYTICS_VIEW_ENABLED: booleanValue(
      config.ADMIN_WEB_ANALYTICS_VIEW_ENABLED,
      true,
      'ADMIN_WEB_ANALYTICS_VIEW_ENABLED',
    ),
    WEB_REMEMBER_LOGIN_ENABLED: booleanValue(
      config.WEB_REMEMBER_LOGIN_ENABLED,
      true,
      'WEB_REMEMBER_LOGIN_ENABLED',
    ),
  };
}
