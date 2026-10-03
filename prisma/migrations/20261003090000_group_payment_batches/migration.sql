ALTER TABLE "payment_records"
ADD COLUMN "batch_id" UUID;

CREATE INDEX "payment_records_batch_id_idx"
ON "payment_records"("batch_id");
