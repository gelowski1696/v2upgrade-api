ALTER TYPE "PortalReportDeliveryStatus" ADD VALUE IF NOT EXISTS 'DELAYED';
ALTER TYPE "PortalReportDeliveryStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "PortalReportDeliveryStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';
ALTER TYPE "PortalReportDeliveryStatus" ADD VALUE IF NOT EXISTS 'COMPLAINED';

ALTER TABLE "portal_report_deliveries"
ADD COLUMN "provider_message_id" VARCHAR(100),
ADD COLUMN "provider_status" VARCHAR(40),
ADD COLUMN "delivered_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "portal_report_deliveries_provider_message_id_key"
ON "portal_report_deliveries"("provider_message_id");
