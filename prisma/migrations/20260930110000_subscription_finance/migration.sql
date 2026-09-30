-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "incurred_at" TIMESTAMPTZ(3) NOT NULL,
    "vendor" VARCHAR(160),
    "reference" VARCHAR(120),
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_incurred_at_currency_idx" ON "expenses"("incurred_at", "currency");

-- CreateIndex
CREATE INDEX "expenses_category_incurred_at_idx" ON "expenses"("category", "incurred_at");

-- CreateIndex
CREATE INDEX "payment_records_paid_at_currency_idx" ON "payment_records"("paid_at", "currency");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
