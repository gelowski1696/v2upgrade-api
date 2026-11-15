DROP INDEX IF EXISTS "devices_subscription_id_key";

CREATE INDEX IF NOT EXISTS "devices_subscription_id_idx"
ON "devices"("subscription_id");
