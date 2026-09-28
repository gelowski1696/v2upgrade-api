CREATE TABLE "portal_sales_targets" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "sales_target" DECIMAL(14,2) NOT NULL,
    "recorded_gross_profit_target" DECIMAL(14,2) NOT NULL,
    "updated_by_portal_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portal_sales_targets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "portal_sales_targets_store_id_month_key"
    ON "portal_sales_targets"("store_id", "month");

CREATE INDEX "portal_sales_targets_updated_by_portal_user_id_updated_at_idx"
    ON "portal_sales_targets"("updated_by_portal_user_id", "updated_at");

ALTER TABLE "portal_sales_targets"
    ADD CONSTRAINT "portal_sales_targets_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portal_sales_targets"
    ADD CONSTRAINT "portal_sales_targets_updated_by_portal_user_id_fkey"
    FOREIGN KEY ("updated_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
