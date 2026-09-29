ALTER TABLE "portal_refresh_sessions"
ADD COLUMN "token_family_id" UUID,
ADD COLUMN "replaced_by_session_id" UUID,
ADD COLUMN "revoked_reason" VARCHAR(40);

UPDATE "portal_refresh_sessions"
SET "token_family_id" = "id"
WHERE "token_family_id" IS NULL;

ALTER TABLE "portal_refresh_sessions"
ALTER COLUMN "token_family_id" SET NOT NULL;

CREATE INDEX "portal_refresh_sessions_token_family_id_revoked_at_idx"
ON "portal_refresh_sessions"("token_family_id", "revoked_at");
