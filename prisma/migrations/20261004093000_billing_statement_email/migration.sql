CREATE TYPE "BillingStatementTarget" AS ENUM ('CLIENT', 'GROUP');

CREATE TYPE "BillingStatementDeliveryStatus" AS ENUM (
  'PROCESSING',
  'SENT',
  'DELAYED',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED'
);

ALTER TABLE "clients"
ADD COLUMN "billing_email" VARCHAR(180);

ALTER TABLE "client_groups"
ADD COLUMN "billing_email" VARCHAR(180);

CREATE TABLE "billing_statement_deliveries" (
  "id" UUID NOT NULL,
  "target_type" "BillingStatementTarget" NOT NULL,
  "client_id" UUID,
  "group_id" UUID,
  "recipient_email" VARCHAR(180) NOT NULL,
  "subject" VARCHAR(180) NOT NULL,
  "statement_date" VARCHAR(10) NOT NULL,
  "due_date" VARCHAR(10),
  "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
  "total_amount" DECIMAL(12,2) NOT NULL,
  "line_items" JSONB NOT NULL,
  "status" "BillingStatementDeliveryStatus" NOT NULL DEFAULT 'PROCESSING',
  "provider_message_id" VARCHAR(100),
  "provider_status" VARCHAR(40),
  "error_code" VARCHAR(80),
  "sent_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "billing_statement_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_statement_target_check" CHECK (
    ("target_type" = 'CLIENT' AND "client_id" IS NOT NULL AND "group_id" IS NULL)
    OR
    ("target_type" = 'GROUP' AND "group_id" IS NOT NULL AND "client_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "billing_statement_deliveries_provider_message_id_key"
ON "billing_statement_deliveries"("provider_message_id");

CREATE INDEX "billing_statement_deliveries_client_id_created_at_idx"
ON "billing_statement_deliveries"("client_id", "created_at");

CREATE INDEX "billing_statement_deliveries_group_id_created_at_idx"
ON "billing_statement_deliveries"("group_id", "created_at");

CREATE INDEX "billing_statement_deliveries_status_created_at_idx"
ON "billing_statement_deliveries"("status", "created_at");

ALTER TABLE "billing_statement_deliveries"
ADD CONSTRAINT "billing_statement_deliveries_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_statement_deliveries"
ADD CONSTRAINT "billing_statement_deliveries_group_id_fkey"
FOREIGN KEY ("group_id") REFERENCES "client_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_statement_deliveries"
ADD CONSTRAINT "billing_statement_deliveries_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
