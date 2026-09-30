CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'VOIDED');

ALTER TABLE "payment_records"
  ADD COLUMN "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
  ADD COLUMN "voided_at" TIMESTAMPTZ(3),
  ADD COLUMN "voided_by_id" UUID,
  ADD COLUMN "void_reason" VARCHAR(250);

CREATE INDEX "payment_records_status_paid_at_currency_idx"
  ON "payment_records"("status", "paid_at", "currency");

ALTER TABLE "payment_records"
  ADD CONSTRAINT "payment_records_voided_by_id_fkey"
  FOREIGN KEY ("voided_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_records"
  ADD CONSTRAINT "payment_records_void_state_check"
  CHECK (
    (
      "status" = 'POSTED'
      AND "voided_at" IS NULL
      AND "voided_by_id" IS NULL
      AND "void_reason" IS NULL
    )
    OR
    (
      "status" = 'VOIDED'
      AND "voided_at" IS NOT NULL
      AND "voided_by_id" IS NOT NULL
      AND char_length(btrim("void_reason")) >= 3
    )
  );
