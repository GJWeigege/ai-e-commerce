-- WB nmID / imtID 已超过 INT4，改用 BIGINT，避免上架成功后回写失败

ALTER TABLE "products" ALTER COLUMN "wbNmId" TYPE BIGINT;
ALTER TABLE "products" ALTER COLUMN "wbImtId" TYPE BIGINT;
ALTER TABLE "product_shop_listings" ALTER COLUMN "wbNmId" TYPE BIGINT;
ALTER TABLE "product_shop_listings" ALTER COLUMN "wbImtId" TYPE BIGINT;
