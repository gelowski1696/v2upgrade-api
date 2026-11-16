-- Portal owners are not subscription-admin users. Keep the existing admin
-- actor column for subscription-app releases and add a separate portal actor
-- for owner-dashboard releases.
ALTER TABLE "master_data_releases"
  ALTER COLUMN "created_by_id" DROP NOT NULL;

ALTER TABLE "master_data_releases"
  ADD COLUMN "created_by_portal_user_id" UUID;

ALTER TABLE "master_data_releases"
  ADD CONSTRAINT "master_data_releases_created_by_portal_user_id_fkey"
  FOREIGN KEY ("created_by_portal_user_id") REFERENCES "portal_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "master_data_releases_created_by_portal_user_id_idx"
  ON "master_data_releases"("created_by_portal_user_id");
