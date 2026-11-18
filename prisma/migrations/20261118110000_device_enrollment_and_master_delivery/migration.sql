CREATE TABLE "device_enrollment_codes" (
  "id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "label" VARCHAR(120),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_by_portal_user_id" UUID NOT NULL,
  "consumed_by_device_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_enrollment_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_enrollment_codes_token_hash_key"
  ON "device_enrollment_codes"("token_hash");
CREATE UNIQUE INDEX "device_enrollment_codes_consumed_by_device_id_key"
  ON "device_enrollment_codes"("consumed_by_device_id");
CREATE INDEX "device_enrollment_codes_client_id_store_id_expires_at_idx"
  ON "device_enrollment_codes"("client_id", "store_id", "expires_at");
CREATE INDEX "device_enrollment_codes_subscription_id_consumed_at_revoked_at_idx"
  ON "device_enrollment_codes"("subscription_id", "consumed_at", "revoked_at");

ALTER TABLE "device_enrollment_codes"
  ADD CONSTRAINT "device_enrollment_codes_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_enrollment_codes"
  ADD CONSTRAINT "device_enrollment_codes_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_enrollment_codes"
  ADD CONSTRAINT "device_enrollment_codes_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_enrollment_codes"
  ADD CONSTRAINT "device_enrollment_codes_created_by_portal_user_id_fkey"
  FOREIGN KEY ("created_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_enrollment_codes"
  ADD CONSTRAINT "device_enrollment_codes_consumed_by_device_id_fkey"
  FOREIGN KEY ("consumed_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "master_data_device_acknowledgements" (
  "id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "application_version" VARCHAR(40),
  "error_code" VARCHAR(80),
  "acknowledged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "master_data_device_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_data_device_acknowledgements_device_id_release_id_key"
  ON "master_data_device_acknowledgements"("device_id", "release_id");
CREATE INDEX "master_data_device_acknowledgements_release_id_status_idx"
  ON "master_data_device_acknowledgements"("release_id", "status");

ALTER TABLE "master_data_device_acknowledgements"
  ADD CONSTRAINT "master_data_device_acknowledgements_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "master_data_device_acknowledgements"
  ADD CONSTRAINT "master_data_device_acknowledgements_release_id_fkey"
  FOREIGN KEY ("release_id") REFERENCES "master_data_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
