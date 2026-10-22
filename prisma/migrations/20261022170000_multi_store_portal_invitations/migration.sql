ALTER TABLE "portal_invitations"
  ADD COLUMN "store_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ALTER COLUMN "created_by_device_id" DROP NOT NULL;

UPDATE "portal_invitations"
SET "store_ids" = ARRAY["store_id"]
WHERE cardinality("store_ids") = 0;
