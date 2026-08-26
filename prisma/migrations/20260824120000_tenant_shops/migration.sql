-- 店铺 Token 密文入库；操作员绑定店铺；商品按店铺独立上下架

ALTER TABLE "platform_accounts" ALTER COLUMN "credentialRef" DROP NOT NULL;
ALTER TABLE "platform_accounts" ADD COLUMN "encryptedSecret" TEXT;

CREATE TABLE "user_shop_accesses" (
    "userId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_shop_accesses_pkey" PRIMARY KEY ("userId","shopId")
);

CREATE TABLE "product_shop_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" "WbListingStatus" NOT NULL DEFAULT 'NONE',
    "error" TEXT,
    "wbNmId" INTEGER,
    "wbImtId" INTEGER,
    "wbVendorCode" TEXT,
    "wbSubjectId" INTEGER,
    "wbSubjectName" TEXT,
    "listedAt" TIMESTAMP(3),
    "unlistedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_shop_listings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_shop_accesses_tenantId_idx" ON "user_shop_accesses"("tenantId");
CREATE INDEX "user_shop_accesses_shopId_idx" ON "user_shop_accesses"("shopId");
CREATE UNIQUE INDEX "product_shop_listings_productId_shopId_key" ON "product_shop_listings"("productId", "shopId");
CREATE INDEX "product_shop_listings_tenantId_shopId_idx" ON "product_shop_listings"("tenantId", "shopId");
CREATE INDEX "product_shop_listings_tenantId_status_idx" ON "product_shop_listings"("tenantId", "status");

ALTER TABLE "user_shop_accesses" ADD CONSTRAINT "user_shop_accesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_shop_accesses" ADD CONSTRAINT "user_shop_accesses_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_shop_accesses" ADD CONSTRAINT "user_shop_accesses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_shop_listings" ADD CONSTRAINT "product_shop_listings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_shop_listings" ADD CONSTRAINT "product_shop_listings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_shop_listings" ADD CONSTRAINT "product_shop_listings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "platform_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 把已有商品上架记录挂到该租户最新的 WB 店铺（若存在）
INSERT INTO "product_shop_listings" (
  "id", "tenantId", "productId", "shopId", "status", "error",
  "wbNmId", "wbImtId", "wbVendorCode", "wbSubjectId", "wbSubjectName",
  "listedAt", "unlistedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."tenantId",
  p."id",
  s."id",
  p."wbListingStatus",
  p."wbListingError",
  p."wbNmId",
  p."wbImtId",
  p."wbVendorCode",
  p."wbSubjectId",
  p."wbSubjectName",
  p."wbListedAt",
  p."offShelfAt",
  NOW(),
  NOW()
FROM "products" p
INNER JOIN LATERAL (
  SELECT pa."id"
  FROM "platform_accounts" pa
  WHERE pa."tenantId" = p."tenantId" AND pa."platform" = 'WILDBERRIES'
  ORDER BY pa."updatedAt" DESC
  LIMIT 1
) s ON TRUE
WHERE p."wbListingStatus" <> 'NONE';
