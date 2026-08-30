-- Ozon 面包屑 → Wildberries 类目映射，避免重复检索并沉淀无尺码类目结论

CREATE TYPE "WbCategoryMapSource" AS ENUM ('AUTO', 'LEARNED', 'MANUAL');

CREATE TABLE "wb_category_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ozonCategoryKey" TEXT NOT NULL,
    "ozonCategoryPath" TEXT NOT NULL,
    "wbSubjectId" INTEGER NOT NULL,
    "wbSubjectName" TEXT NOT NULL,
    "sized" BOOLEAN,
    "source" "WbCategoryMapSource" NOT NULL DEFAULT 'AUTO',
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wb_category_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wb_category_mappings_tenantId_ozonCategoryKey_key"
    ON "wb_category_mappings" ("tenantId", "ozonCategoryKey");

CREATE INDEX "wb_category_mappings_tenantId_wbSubjectId_idx"
    ON "wb_category_mappings" ("tenantId", "wbSubjectId");

ALTER TABLE "wb_category_mappings"
    ADD CONSTRAINT "wb_category_mappings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
