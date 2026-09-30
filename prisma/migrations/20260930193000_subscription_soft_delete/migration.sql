ALTER TABLE "subscriptions"
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "deleted_by_id" UUID;

CREATE INDEX "subscriptions_deleted_at_status_created_at_idx"
  ON "subscriptions"("deleted_at", "status", "created_at");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_deleted_by_id_fkey"
  FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
