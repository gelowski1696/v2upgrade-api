ALTER TABLE "devices"
ALTER COLUMN "fingerprint_hash" DROP NOT NULL;

CREATE UNIQUE INDEX "devices_subscription_id_key"
ON "devices"("subscription_id");
