CREATE TYPE "MasterDataReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ROLLED_BACK');
CREATE TYPE "MasterDataEntityType" AS ENUM ('CATEGORY', 'BRAND', 'CYLINDER_SIZE', 'PRODUCT', 'SUPPLIER', 'PRICE');
CREATE TYPE "MasterDataChangeOperation" AS ENUM ('UPSERT', 'DEACTIVATE');

CREATE TABLE "master_data_releases" (
  "id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "MasterDataReleaseStatus" NOT NULL DEFAULT 'DRAFT',
  "release_hash" CHAR(64),
  "notes" TEXT,
  "created_by_id" UUID NOT NULL,
  "published_at" TIMESTAMPTZ(3),
  "rolled_back_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "master_data_releases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "master_data_release_entries" (
  "id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "entity_type" "MasterDataEntityType" NOT NULL,
  "operation" "MasterDataChangeOperation" NOT NULL,
  "stable_key" VARCHAR(180) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "master_data_release_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_data_releases_client_id_version_key"
  ON "master_data_releases"("client_id", "version");
CREATE INDEX "master_data_releases_client_id_status_version_idx"
  ON "master_data_releases"("client_id", "status", "version");
CREATE UNIQUE INDEX "master_data_release_entries_release_id_entity_type_stable_key_key"
  ON "master_data_release_entries"("release_id", "entity_type", "stable_key");
CREATE INDEX "master_data_release_entries_release_id_entity_type_idx"
  ON "master_data_release_entries"("release_id", "entity_type");

ALTER TABLE "master_data_releases"
  ADD CONSTRAINT "master_data_releases_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "master_data_releases"
  ADD CONSTRAINT "master_data_releases_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "master_data_release_entries"
  ADD CONSTRAINT "master_data_release_entries_release_id_fkey"
  FOREIGN KEY ("release_id") REFERENCES "master_data_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
