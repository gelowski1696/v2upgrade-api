CREATE TYPE "SocialConnectionStatus" AS ENUM ('ACTIVE', 'ACTION_REQUIRED', 'DISCONNECTED');
CREATE TYPE "SocialOauthStatus" AS ENUM ('PENDING', 'AWAITING_PAGE', 'COMPLETE', 'FAILED', 'EXPIRED');
CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');
CREATE TYPE "SocialConversationStatus" AS ENUM ('OPEN', 'WAITING', 'ASSIGNED', 'RESOLVED');
CREATE TYPE "SocialMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');
CREATE TYPE "SocialMessageSender" AS ENUM ('CUSTOMER', 'CASHIER', 'BOT', 'SYSTEM');
CREATE TYPE "SocialAutomationMode" AS ENUM ('OFF', 'FAQ_ONLY', 'ASSISTED');

CREATE TABLE "social_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "provider" VARCHAR(20) NOT NULL DEFAULT 'META',
  "page_id" VARCHAR(120) NOT NULL,
  "page_name" VARCHAR(180) NOT NULL,
  "status" "SocialConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "token_ciphertext" TEXT NOT NULL,
  "token_expires_at" TIMESTAMPTZ(3),
  "granted_permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "page_tasks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_checked_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "connected_by" VARCHAR(120) NOT NULL,
  "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnected_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_connections_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "social_connections_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_oauth_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "client_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "state_hash" CHAR(64) NOT NULL,
  "status" "SocialOauthStatus" NOT NULL DEFAULT 'PENDING',
  "actor" VARCHAR(120) NOT NULL,
  "user_token_ciphertext" TEXT,
  "page_candidates" JSONB NOT NULL DEFAULT '[]',
  "connection_id" UUID,
  "error_message" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_oauth_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_oauth_attempts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_post_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "body" TEXT NOT NULL,
  "auto_publish" BOOLEAN NOT NULL DEFAULT false,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "created_by" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_post_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_post_templates_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_posts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "template_id" UUID,
  "content" TEXT NOT NULL,
  "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduled_at" TIMESTAMPTZ(3),
  "published_at" TIMESTAMPTZ(3),
  "provider_post_id" VARCHAR(180),
  "idempotency_key" VARCHAR(120) NOT NULL,
  "created_by" VARCHAR(120) NOT NULL,
  "approved_by" VARCHAR(120),
  "approved_at" TIMESTAMPTZ(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "generation_metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_posts_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "social_posts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "social_post_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "social_conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "participant_id" VARCHAR(180) NOT NULL,
  "participant_name" VARCHAR(180),
  "status" "SocialConversationStatus" NOT NULL DEFAULT 'OPEN',
  "automation_mode" "SocialAutomationMode" NOT NULL DEFAULT 'FAQ_ONLY',
  "assigned_to" VARCHAR(120),
  "assigned_at" TIMESTAMPTZ(3),
  "last_inbound_at" TIMESTAMPTZ(3),
  "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_conversations_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "provider_message_id" VARCHAR(220),
  "direction" "SocialMessageDirection" NOT NULL,
  "sender" "SocialMessageSender" NOT NULL,
  "sender_name" VARCHAR(120),
  "text" TEXT,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "delivery_status" VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  "sent_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_messages_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "social_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_faqs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "question" VARCHAR(240) NOT NULL,
  "answer" TEXT NOT NULL,
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "social_faqs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_faqs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_cashier_presence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "username" VARCHAR(120) NOT NULL,
  "display_name" VARCHAR(160) NOT NULL,
  "availability" VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_cashier_presence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_cashier_presence_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "social_cashier_presence_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connection_id" UUID,
  "event_hash" CHAR(64) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMPTZ(3),
  "processed_at" TIMESTAMPTZ(3),
  CONSTRAINT "social_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_webhook_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "social_connections_store_id_page_id_key" ON "social_connections"("store_id", "page_id");
CREATE INDEX "social_connections_client_id_store_id_status_idx" ON "social_connections"("client_id", "store_id", "status");
CREATE UNIQUE INDEX "social_oauth_attempts_state_hash_key" ON "social_oauth_attempts"("state_hash");
CREATE INDEX "social_oauth_attempts_device_id_status_created_at_idx" ON "social_oauth_attempts"("device_id", "status", "created_at");
CREATE UNIQUE INDEX "social_post_templates_connection_id_name_key" ON "social_post_templates"("connection_id", "name");
CREATE INDEX "social_post_templates_connection_id_updated_at_idx" ON "social_post_templates"("connection_id", "updated_at");
CREATE UNIQUE INDEX "social_posts_idempotency_key_key" ON "social_posts"("idempotency_key");
CREATE INDEX "social_posts_connection_id_status_scheduled_at_idx" ON "social_posts"("connection_id", "status", "scheduled_at");
CREATE UNIQUE INDEX "social_conversations_connection_id_participant_id_key" ON "social_conversations"("connection_id", "participant_id");
CREATE INDEX "social_conversations_connection_id_status_last_message_at_idx" ON "social_conversations"("connection_id", "status", "last_message_at");
CREATE UNIQUE INDEX "social_messages_connection_id_provider_message_id_key" ON "social_messages"("connection_id", "provider_message_id");
CREATE INDEX "social_messages_conversation_id_sent_at_idx" ON "social_messages"("conversation_id", "sent_at");
CREATE INDEX "social_faqs_connection_id_enabled_idx" ON "social_faqs"("connection_id", "enabled");
CREATE UNIQUE INDEX "social_cashier_presence_connection_id_device_id_username_key" ON "social_cashier_presence"("connection_id", "device_id", "username");
CREATE INDEX "social_cashier_presence_connection_id_availability_last_seen_idx" ON "social_cashier_presence"("connection_id", "availability", "last_seen_at");
CREATE UNIQUE INDEX "social_webhook_events_event_hash_key" ON "social_webhook_events"("event_hash");
CREATE INDEX "social_webhook_events_status_received_at_idx" ON "social_webhook_events"("status", "received_at");
