CREATE TABLE "portal_alert_dismissals" (
    "id" UUID NOT NULL,
    "portal_user_id" UUID NOT NULL,
    "alert_id" VARCHAR(255) NOT NULL,
    "dismissed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portal_alert_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_alert_dismissals_portal_user_id_alert_id_key"
ON "portal_alert_dismissals"("portal_user_id", "alert_id");

CREATE INDEX "portal_alert_dismissals_portal_user_id_dismissed_at_idx"
ON "portal_alert_dismissals"("portal_user_id", "dismissed_at");

ALTER TABLE "portal_alert_dismissals"
ADD CONSTRAINT "portal_alert_dismissals_portal_user_id_fkey"
FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
