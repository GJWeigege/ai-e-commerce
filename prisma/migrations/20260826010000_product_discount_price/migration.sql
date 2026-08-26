ALTER TABLE "product_snapshots" ADD COLUMN IF NOT EXISTS "discountPrice" DECIMAL(12,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "discountPrice" DECIMAL(12,2);
