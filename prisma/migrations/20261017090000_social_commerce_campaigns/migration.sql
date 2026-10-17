CREATE TYPE "SocialQuoteStatus" AS ENUM (
  'DRAFT', 'SENT', 'ACCEPTED', 'READY_TO_IMPORT', 'IMPORTING',
  'IMPORTED', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'IMPORT_FAILED'
);

CREATE TYPE "SocialCampaignStatus" AS ENUM (
  'SUGGESTED', 'DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE',
  'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'
);

CREATE TABLE "social_customer_links" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "pos_customer_id" INTEGER NOT NULL,
  "customer_name" VARCHAR(180) NOT NULL,
  "customer_contact" VARCHAR(80),
  "verified_method" VARCHAR(40) NOT NULL DEFAULT 'CASHIER_CONFIRMED',
  "linked_by" VARCHAR(120) NOT NULL,
  "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unlinked_at" TIMESTAMPTZ(3),
  CONSTRAINT "social_customer_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_campaign_rules" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "trigger_type" VARCHAR(60) NOT NULL,
  "thresholds" JSONB NOT NULL DEFAULT '{}',
  "cooldown_days" INTEGER NOT NULL DEFAULT 14,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "auto_schedule" BOOLEAN NOT NULL DEFAULT false,
  "created_by" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_campaign_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_campaign_signals" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "rule_id" UUID,
  "signal_type" VARCHAR(60) NOT NULL,
  "source_snapshot_id" UUID,
  "facts" JSONB NOT NULL DEFAULT '{}',
  "eligible" BOOLEAN NOT NULL DEFAULT true,
  "suppression_reason" TEXT,
  "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3),
  CONSTRAINT "social_campaign_signals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_campaigns" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "signal_id" UUID,
  "name" VARCHAR(180) NOT NULL,
  "goal" VARCHAR(120) NOT NULL,
  "status" "SocialCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "facts" JSONB NOT NULL DEFAULT '{}',
  "tracking_code" VARCHAR(40) NOT NULL,
  "created_by" VARCHAR(120) NOT NULL,
  "approved_by" VARCHAR(120),
  "approved_at" TIMESTAMPTZ(3),
  "starts_at" TIMESTAMPTZ(3),
  "ends_at" TIMESTAMPTZ(3),
  "paused_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_campaign_variants" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "facts_hash" CHAR(64) NOT NULL,
  "provider" VARCHAR(60) NOT NULL DEFAULT 'TEMPLATE',
  "model" VARCHAR(120) NOT NULL DEFAULT '',
  "validation_passed" BOOLEAN NOT NULL DEFAULT false,
  "validation_messages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "post_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_campaign_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_quotes" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "customer_link_id" UUID,
  "source_campaign_id" UUID,
  "status" "SocialQuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
  "subtotal_minor" INTEGER NOT NULL DEFAULT 0,
  "adjustment_minor" INTEGER NOT NULL DEFAULT 0,
  "total_minor" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT NOT NULL DEFAULT '',
  "source_snapshot_id" UUID,
  "source_snapshot_at" TIMESTAMPTZ(3),
  "idempotency_key" VARCHAR(120) NOT NULL,
  "created_by" VARCHAR(120) NOT NULL,
  "approved_by" VARCHAR(120),
  "expires_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "accepted_at" TIMESTAMPTZ(3),
  "import_claimed_by" VARCHAR(120),
  "import_claimed_at" TIMESTAMPTZ(3),
  "local_queue_id" INTEGER,
  "local_queue_reference" VARCHAR(120),
  "imported_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_quotes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_quote_lines" (
  "id" UUID NOT NULL,
  "quote_id" UUID NOT NULL,
  "pos_item_id" INTEGER NOT NULL,
  "item_code" VARCHAR(120) NOT NULL,
  "item_name" VARCHAR(240) NOT NULL,
  "item_size" VARCHAR(120) NOT NULL DEFAULT '',
  "unit" VARCHAR(30) NOT NULL DEFAULT 'NON-REFILL',
  "quantity" INTEGER NOT NULL,
  "unit_price_minor" INTEGER NOT NULL,
  "line_total_minor" INTEGER NOT NULL,
  "source_snapshot_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_commerce_events" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "quote_id" UUID,
  "event_type" VARCHAR(60) NOT NULL,
  "actor" VARCHAR(120) NOT NULL,
  "device_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_commerce_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_campaign_metrics_daily" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "metric_date" DATE NOT NULL,
  "published" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "conversations" INTEGER NOT NULL DEFAULT 0,
  "quotes_sent" INTEGER NOT NULL DEFAULT 0,
  "quotes_accepted" INTEGER NOT NULL DEFAULT 0,
  "orders_imported" INTEGER NOT NULL DEFAULT 0,
  "sales_completed" INTEGER NOT NULL DEFAULT 0,
  "revenue_minor" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_campaign_metrics_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_attributions" (
  "id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "conversation_id" UUID,
  "quote_id" UUID,
  "local_order_reference" VARCHAR(120),
  "method" VARCHAR(40) NOT NULL,
  "revenue_minor" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_attributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_customer_links_conversation_id_key" ON "social_customer_links"("conversation_id");
CREATE INDEX "social_customer_links_connection_id_pos_customer_id_idx" ON "social_customer_links"("connection_id", "pos_customer_id");
CREATE UNIQUE INDEX "social_quotes_idempotency_key_key" ON "social_quotes"("idempotency_key");
CREATE INDEX "social_quotes_connection_id_status_updated_at_idx" ON "social_quotes"("connection_id", "status", "updated_at");
CREATE INDEX "social_quotes_conversation_id_created_at_idx" ON "social_quotes"("conversation_id", "created_at");
CREATE INDEX "social_quote_lines_quote_id_idx" ON "social_quote_lines"("quote_id");
CREATE INDEX "social_commerce_events_connection_id_created_at_idx" ON "social_commerce_events"("connection_id", "created_at");
CREATE INDEX "social_commerce_events_quote_id_created_at_idx" ON "social_commerce_events"("quote_id", "created_at");
CREATE UNIQUE INDEX "social_campaign_rules_connection_id_name_key" ON "social_campaign_rules"("connection_id", "name");
CREATE INDEX "social_campaign_rules_connection_id_enabled_idx" ON "social_campaign_rules"("connection_id", "enabled");
CREATE INDEX "social_campaign_signals_connection_id_eligible_detected_at_idx" ON "social_campaign_signals"("connection_id", "eligible", "detected_at");
CREATE UNIQUE INDEX "social_campaigns_tracking_code_key" ON "social_campaigns"("tracking_code");
CREATE INDEX "social_campaigns_connection_id_status_updated_at_idx" ON "social_campaigns"("connection_id", "status", "updated_at");
CREATE INDEX "social_campaign_variants_campaign_id_selected_idx" ON "social_campaign_variants"("campaign_id", "selected");
CREATE UNIQUE INDEX "social_campaign_metrics_daily_campaign_id_metric_date_key" ON "social_campaign_metrics_daily"("campaign_id", "metric_date");
CREATE INDEX "social_campaign_metrics_daily_connection_id_metric_date_idx" ON "social_campaign_metrics_daily"("connection_id", "metric_date");
CREATE UNIQUE INDEX "social_attributions_campaign_id_local_order_reference_key" ON "social_attributions"("campaign_id", "local_order_reference");
CREATE INDEX "social_attributions_connection_id_created_at_idx" ON "social_attributions"("connection_id", "created_at");

ALTER TABLE "social_customer_links" ADD CONSTRAINT "social_customer_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_customer_links" ADD CONSTRAINT "social_customer_links_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_campaign_rules" ADD CONSTRAINT "social_campaign_rules_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_campaign_signals" ADD CONSTRAINT "social_campaign_signals_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_campaign_signals" ADD CONSTRAINT "social_campaign_signals_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "social_campaign_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_campaigns" ADD CONSTRAINT "social_campaigns_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_campaigns" ADD CONSTRAINT "social_campaigns_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "social_campaign_signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_campaign_variants" ADD CONSTRAINT "social_campaign_variants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "social_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_quotes" ADD CONSTRAINT "social_quotes_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_quotes" ADD CONSTRAINT "social_quotes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_quotes" ADD CONSTRAINT "social_quotes_customer_link_id_fkey" FOREIGN KEY ("customer_link_id") REFERENCES "social_customer_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_quotes" ADD CONSTRAINT "social_quotes_source_campaign_id_fkey" FOREIGN KEY ("source_campaign_id") REFERENCES "social_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_quote_lines" ADD CONSTRAINT "social_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "social_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_commerce_events" ADD CONSTRAINT "social_commerce_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_commerce_events" ADD CONSTRAINT "social_commerce_events_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "social_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_campaign_metrics_daily" ADD CONSTRAINT "social_campaign_metrics_daily_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_campaign_metrics_daily" ADD CONSTRAINT "social_campaign_metrics_daily_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "social_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_attributions" ADD CONSTRAINT "social_attributions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_attributions" ADD CONSTRAINT "social_attributions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "social_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_attributions" ADD CONSTRAINT "social_attributions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "social_attributions" ADD CONSTRAINT "social_attributions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "social_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
