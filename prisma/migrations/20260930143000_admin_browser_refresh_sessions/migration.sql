ALTER TABLE "refresh_sessions"
  ADD COLUMN "token_family_id" UUID,
  ADD COLUMN "replaced_by_session_id" UUID,
  ADD COLUMN "revoked_reason" VARCHAR(40),
  ADD COLUMN "browser_session" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "refresh_sessions"
SET "token_family_id" = "id"
WHERE "token_family_id" IS NULL;

ALTER TABLE "refresh_sessions"
  ALTER COLUMN "token_family_id" SET NOT NULL,
  ALTER COLUMN "token_family_id" SET DEFAULT gen_random_uuid();

CREATE INDEX "refresh_sessions_token_family_id_revoked_at_idx"
  ON "refresh_sessions"("token_family_id", "revoked_at");
