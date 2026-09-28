ALTER TABLE "portal_refresh_sessions"
ADD COLUMN "user_agent" VARCHAR(500),
ADD COLUMN "ip_address" VARCHAR(80),
ADD COLUMN "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "portal_password_resets" (
    "id" UUID NOT NULL,
    "portal_user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_device_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_password_resets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_password_resets_token_hash_key"
ON "portal_password_resets"("token_hash");

CREATE INDEX "portal_password_resets_portal_user_id_expires_at_idx"
ON "portal_password_resets"("portal_user_id", "expires_at");

ALTER TABLE "portal_password_resets"
ADD CONSTRAINT "portal_password_resets_portal_user_id_fkey"
FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portal_password_resets"
ADD CONSTRAINT "portal_password_resets_created_by_device_id_fkey"
FOREIGN KEY ("created_by_device_id") REFERENCES "devices"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
