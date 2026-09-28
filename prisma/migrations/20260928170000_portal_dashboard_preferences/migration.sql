CREATE TABLE "portal_dashboard_preferences" (
  "portal_user_id" UUID NOT NULL,
  "overview_metrics" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "portal_dashboard_preferences_pkey" PRIMARY KEY ("portal_user_id")
);

CREATE TABLE "portal_saved_views" (
  "id" UUID NOT NULL,
  "portal_user_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "report" VARCHAR(60) NOT NULL,
  "date_preset" VARCHAR(24) NOT NULL,
  "date_from" VARCHAR(10),
  "date_to" VARCHAR(10),
  "filters" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "portal_saved_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_saved_views_portal_user_id_name_key"
  ON "portal_saved_views"("portal_user_id", "name");
CREATE INDEX "portal_saved_views_portal_user_id_updated_at_idx"
  ON "portal_saved_views"("portal_user_id", "updated_at");
CREATE INDEX "portal_saved_views_store_id_idx" ON "portal_saved_views"("store_id");

ALTER TABLE "portal_dashboard_preferences"
  ADD CONSTRAINT "portal_dashboard_preferences_portal_user_id_fkey"
  FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portal_saved_views"
  ADD CONSTRAINT "portal_saved_views_portal_user_id_fkey"
  FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portal_saved_views"
  ADD CONSTRAINT "portal_saved_views_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
