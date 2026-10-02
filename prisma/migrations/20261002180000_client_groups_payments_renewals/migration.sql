-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('INITIAL', 'RENEWAL', 'MODIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ClientGroupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "client_groups" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "ClientGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "client_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_renewals" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "previous_expires_at" TIMESTAMPTZ(3),
    "period_starts_at" TIMESTAMPTZ(3) NOT NULL,
    "period_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "billing_interval" "BillingInterval" NOT NULL,
    "reason" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_renewals_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "clients" ADD COLUMN "group_id" UUID;

-- AlterTable: add nullable columns first so existing rows can be backfilled safely.
ALTER TABLE "payment_records"
ADD COLUMN "client_id" UUID,
ADD COLUMN "renewal_id" UUID,
ADD COLUMN "purpose" "PaymentPurpose" NOT NULL DEFAULT 'OTHER',
ADD COLUMN "description" VARCHAR(250);

UPDATE "payment_records" AS payment
SET "client_id" = subscription."client_id",
    "description" = COALESCE(payment."description", 'Legacy subscription payment')
FROM "subscriptions" AS subscription
WHERE payment."subscription_id" = subscription."id";

ALTER TABLE "payment_records" ALTER COLUMN "client_id" SET NOT NULL;
ALTER TABLE "payment_records" ALTER COLUMN "subscription_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "client_groups_code_key" ON "client_groups"("code");
CREATE UNIQUE INDEX "client_groups_name_key" ON "client_groups"("name");
CREATE INDEX "client_groups_status_name_idx" ON "client_groups"("status", "name");
CREATE INDEX "clients_group_id_status_idx" ON "clients"("group_id", "status");
CREATE INDEX "subscription_renewals_subscription_id_created_at_idx" ON "subscription_renewals"("subscription_id", "created_at");
CREATE INDEX "payment_records_client_id_paid_at_idx" ON "payment_records"("client_id", "paid_at");
CREATE INDEX "payment_records_renewal_id_idx" ON "payment_records"("renewal_id");
CREATE INDEX "payment_records_purpose_paid_at_currency_idx" ON "payment_records"("purpose", "paid_at", "currency");

-- AddForeignKey
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "client_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscription_renewals" ADD CONSTRAINT "subscription_renewals_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_renewals" ADD CONSTRAINT "subscription_renewals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_renewal_id_fkey" FOREIGN KEY ("renewal_id") REFERENCES "subscription_renewals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
