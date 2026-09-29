CREATE TYPE "WebAnalyticsEventType" AS ENUM (
  'PAGE_VIEW',
  'FEATURE_USED',
  'FRONTEND_ERROR',
  'API_FAILURE',
  'WEB_VITAL'
);

CREATE TYPE "WebAnalyticsDeviceClass" AS ENUM (
  'DESKTOP',
  'MOBILE',
  'TABLET',
  'UNKNOWN'
);

CREATE TYPE "WebAnalyticsBrowserFamily" AS ENUM (
  'CHROME',
  'EDGE',
  'FIREFOX',
  'SAFARI',
  'OTHER'
);

CREATE TYPE "WebVitalName" AS ENUM ('LCP', 'INP', 'CLS');

ALTER TABLE "clients"
ADD COLUMN "web_analytics_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "web_analytics_events" (
  "id" UUID NOT NULL,
  "event_key" UUID NOT NULL,
  "event_type" "WebAnalyticsEventType" NOT NULL,
  "client_id" UUID NOT NULL,
  "store_id" UUID,
  "portal_user_id" UUID NOT NULL,
  "portal_session_id" UUID NOT NULL,
  "portal_role" "PortalRole" NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "route" VARCHAR(120) NOT NULL,
  "feature" VARCHAR(60),
  "operation" VARCHAR(60),
  "error_code" VARCHAR(80),
  "http_status" INTEGER,
  "metric_name" "WebVitalName",
  "metric_value" DOUBLE PRECISION,
  "app_release" VARCHAR(64) NOT NULL,
  "device_class" "WebAnalyticsDeviceClass" NOT NULL,
  "browser_family" "WebAnalyticsBrowserFamily" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "web_analytics_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "web_analytics_events_http_status_check"
    CHECK ("http_status" IS NULL OR "http_status" BETWEEN 400 AND 599),
  CONSTRAINT "web_analytics_events_metric_value_check"
    CHECK ("metric_value" IS NULL OR "metric_value" >= 0)
);

CREATE UNIQUE INDEX "web_analytics_events_portal_user_id_event_key_key"
ON "web_analytics_events"("portal_user_id", "event_key");

CREATE INDEX "web_analytics_events_client_id_occurred_at_idx"
ON "web_analytics_events"("client_id", "occurred_at");

CREATE INDEX "web_analytics_events_client_id_event_type_occurred_at_idx"
ON "web_analytics_events"("client_id", "event_type", "occurred_at");

CREATE INDEX "web_analytics_events_store_id_occurred_at_idx"
ON "web_analytics_events"("store_id", "occurred_at");

CREATE INDEX "web_analytics_events_app_release_occurred_at_idx"
ON "web_analytics_events"("app_release", "occurred_at");

ALTER TABLE "web_analytics_events"
ADD CONSTRAINT "web_analytics_events_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "web_analytics_events"
ADD CONSTRAINT "web_analytics_events_store_id_fkey"
FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "web_analytics_events"
ADD CONSTRAINT "web_analytics_events_portal_user_id_fkey"
FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
