CREATE TYPE "PortalReportFrequency" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "PortalReportDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "portal_users"
ADD COLUMN "email_verified_at" TIMESTAMPTZ(3);

CREATE TABLE "portal_email_verifications" (
    "id" UUID NOT NULL,
    "portal_user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_email_verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal_report_schedules" (
    "id" UUID NOT NULL,
    "portal_user_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "frequency" "PortalReportFrequency" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "next_run_at" TIMESTAMPTZ(3),
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "portal_report_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal_report_deliveries" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "period_from" VARCHAR(10) NOT NULL,
    "period_to" VARCHAR(10) NOT NULL,
    "recipient_email" VARCHAR(180) NOT NULL,
    "status" "PortalReportDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "snapshot_age_hours" INTEGER,
    "data_quality_status" VARCHAR(20),
    "warning" VARCHAR(255),
    "error_code" VARCHAR(80),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "portal_report_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portal_email_verifications_portal_user_id_created_at_idx"
ON "portal_email_verifications"("portal_user_id", "created_at");
CREATE UNIQUE INDEX "portal_report_schedules_portal_user_id_store_id_frequency_key"
ON "portal_report_schedules"("portal_user_id", "store_id", "frequency");
CREATE INDEX "portal_report_schedules_enabled_next_run_at_idx"
ON "portal_report_schedules"("enabled", "next_run_at");
CREATE UNIQUE INDEX "portal_report_deliveries_schedule_id_period_from_period_to_key"
ON "portal_report_deliveries"("schedule_id", "period_from", "period_to");
CREATE INDEX "portal_report_deliveries_status_next_attempt_at_idx"
ON "portal_report_deliveries"("status", "next_attempt_at");
CREATE INDEX "portal_report_deliveries_schedule_id_created_at_idx"
ON "portal_report_deliveries"("schedule_id", "created_at");

ALTER TABLE "portal_email_verifications"
ADD CONSTRAINT "portal_email_verifications_portal_user_id_fkey"
FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_report_schedules"
ADD CONSTRAINT "portal_report_schedules_portal_user_id_fkey"
FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_report_schedules"
ADD CONSTRAINT "portal_report_schedules_store_id_fkey"
FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_report_deliveries"
ADD CONSTRAINT "portal_report_deliveries_schedule_id_fkey"
FOREIGN KEY ("schedule_id") REFERENCES "portal_report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
