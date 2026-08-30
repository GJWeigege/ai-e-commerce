-- CreateEnum
CREATE TYPE "OzonFulfillment" AS ENUM ('FBO', 'FBS', 'MIXED');

-- AlterTable
ALTER TABLE "product_snapshots" ADD COLUMN IF NOT EXISTS "warehouseType" "OzonFulfillment";
ALTER TABLE "product_snapshots" ADD COLUMN IF NOT EXISTS "fboStock" INTEGER;
ALTER TABLE "product_snapshots" ADD COLUMN IF NOT EXISTS "fbsStock" INTEGER;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "warehouseType" "OzonFulfillment";
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "fboStock" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "fbsStock" INTEGER;
