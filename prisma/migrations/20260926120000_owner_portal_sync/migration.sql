CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "PortalRole" AS ENUM ('OWNER', 'MANAGER', 'VIEWER');
CREATE TYPE "PortalUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');
CREATE TYPE "SnapshotStatus" AS ENUM ('STAGING', 'VALIDATING', 'READY', 'ACTIVE', 'REJECTED', 'RETIRED');
CREATE TYPE "UploadSessionStatus" AS ENUM ('CREATED', 'UPLOADING', 'UPLOADED', 'VALIDATING', 'COMPLETE', 'REJECTED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Manila',
    "active_snapshot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

INSERT INTO "stores" ("id", "client_id", "code", "name", "updated_at")
SELECT md5("id"::text || ':default-store')::uuid, "id", 'MAIN', "business_name", CURRENT_TIMESTAMP
FROM "clients";

ALTER TABLE "devices" ADD COLUMN "store_id" UUID;
UPDATE "devices" d
SET "store_id" = s."id"
FROM "stores" s
WHERE s."client_id" = d."client_id" AND s."code" = 'MAIN';
ALTER TABLE "devices" ALTER COLUMN "store_id" SET NOT NULL;

CREATE TABLE "portal_users" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "username" VARCHAR(180) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "PortalRole" NOT NULL DEFAULT 'VIEWER',
    "status" "PortalUserStatus" NOT NULL DEFAULT 'INVITED',
    "password_changed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal_refresh_sessions" (
    "id" UUID NOT NULL,
    "portal_user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_refresh_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portal_store_access" (
    "portal_user_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "role_override" "PortalRole",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_store_access_pkey" PRIMARY KEY ("portal_user_id", "store_id")
);

CREATE TABLE "portal_invitations" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "username" VARCHAR(180) NOT NULL,
    "display_name" VARCHAR(160) NOT NULL,
    "role" "PortalRole" NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_device_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_snapshots" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "application_version" VARCHAR(40) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'STAGING',
    "snapshot_created_at" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(3),
    "rejection_code" VARCHAR(80),
    "rejection_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_upload_sessions" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "expected_size" BIGINT NOT NULL,
    "expected_sha256" CHAR(64) NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "application_version" VARCHAR(40) NOT NULL,
    "snapshot_created_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'CREATED',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "received_bytes" BIGINT NOT NULL DEFAULT 0,
    "snapshot_id" UUID,
    "rejection_code" VARCHAR(80),
    "rejection_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "sync_upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stores_active_snapshot_id_key" ON "stores"("active_snapshot_id");
CREATE UNIQUE INDEX "stores_client_id_code_key" ON "stores"("client_id", "code");
CREATE INDEX "stores_client_id_status_idx" ON "stores"("client_id", "status");
CREATE INDEX "devices_store_id_status_idx" ON "devices"("store_id", "status");
CREATE UNIQUE INDEX "portal_users_username_key" ON "portal_users"("username");
CREATE INDEX "portal_users_client_id_status_idx" ON "portal_users"("client_id", "status");
CREATE INDEX "portal_refresh_sessions_portal_user_id_revoked_at_idx" ON "portal_refresh_sessions"("portal_user_id", "revoked_at");
CREATE INDEX "portal_store_access_store_id_idx" ON "portal_store_access"("store_id");
CREATE UNIQUE INDEX "portal_invitations_token_hash_key" ON "portal_invitations"("token_hash");
CREATE INDEX "portal_invitations_client_id_username_idx" ON "portal_invitations"("client_id", "username");
CREATE INDEX "portal_invitations_store_id_expires_at_idx" ON "portal_invitations"("store_id", "expires_at");
CREATE UNIQUE INDEX "store_snapshots_store_id_sha256_key" ON "store_snapshots"("store_id", "sha256");
CREATE INDEX "store_snapshots_store_id_status_uploaded_at_idx" ON "store_snapshots"("store_id", "status", "uploaded_at");
CREATE INDEX "sync_upload_sessions_store_id_status_created_at_idx" ON "sync_upload_sessions"("store_id", "status", "created_at");
CREATE INDEX "sync_upload_sessions_device_id_status_idx" ON "sync_upload_sessions"("device_id", "status");

ALTER TABLE "stores" ADD CONSTRAINT "stores_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portal_refresh_sessions" ADD CONSTRAINT "portal_refresh_sessions_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_store_access" ADD CONSTRAINT "portal_store_access_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_store_access" ADD CONSTRAINT "portal_store_access_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_created_by_device_id_fkey" FOREIGN KEY ("created_by_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_snapshots" ADD CONSTRAINT "store_snapshots_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_snapshots" ADD CONSTRAINT "store_snapshots_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stores" ADD CONSTRAINT "stores_active_snapshot_id_fkey" FOREIGN KEY ("active_snapshot_id") REFERENCES "store_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_upload_sessions" ADD CONSTRAINT "sync_upload_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_upload_sessions" ADD CONSTRAINT "sync_upload_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
