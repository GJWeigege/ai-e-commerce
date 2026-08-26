-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TenantIsolationMode" AS ENUM ('SHARED', 'DEDICATED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('MENU', 'DATA', 'ACTION');

-- CreateEnum
CREATE TYPE "CollectorType" AS ENUM ('PLAYWRIGHT', 'ELECTRON', 'CHROME_EXT');

-- CreateEnum
CREATE TYPE "CollectorAgentStatus" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY');

-- CreateEnum
CREATE TYPE "CrawlerMode" AS ENUM ('CATEGORY_TOP', 'CSV_URL');

-- CreateEnum
CREATE TYPE "CrawlerTaskStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'PAUSED', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrawlerItemStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'RETRYING', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('CRAWLED', 'AI_PENDING', 'AI_DONE', 'REVIEW_PENDING', 'APPROVED', 'REJECTED', 'ON_SHELF', 'OFF_SHELF');

-- CreateEnum
CREATE TYPE "AiSelectionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('APPROVE', 'REJECT', 'EDIT');

-- CreateEnum
CREATE TYPE "PlatformCode" AS ENUM ('OZON', 'WILDBERRIES');

-- CreateEnum
CREATE TYPE "PlatformAccountStatus" AS ENUM ('ENABLED', 'DISABLED', 'PLACEHOLDER');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('CREATED', 'PURCHASE_PENDING', 'PURCHASING', 'IN_TRANSIT_WB', 'ARRIVED_WB', 'INBOUND', 'SHIPPED', 'COMPLETED', 'EXCEPTION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('PENDING_PURCHASE', 'PURCHASE_SUCCESS', 'PURCHASE_FAILED', 'SHIPPED_TO_WB', 'ARRIVED_WB');

-- CreateEnum
CREATE TYPE "LogisticsRelatedType" AS ENUM ('PURCHASE_ORDER', 'SALES_ORDER');

-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('WB_OFFICIAL', 'LOCAL_FULFILLMENT');

-- CreateEnum
CREATE TYPE "FileBizType" AS ENUM ('CRAWLER_CSV', 'EXPORT', 'OTHER');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "isolationMode" "TenantIsolationMode" NOT NULL DEFAULT 'SHARED',
    "databaseUrlRef" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "realName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PermissionType" NOT NULL,
    "resource" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "tenantId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platform" "PlatformCode" NOT NULL,
    "name" TEXT NOT NULL,
    "credentialRef" TEXT NOT NULL,
    "extra" JSONB,
    "status" "PlatformAccountStatus" NOT NULL DEFAULT 'PLACEHOLDER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collector_agents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "CollectorType" NOT NULL,
    "agentKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CollectorAgentStatus" NOT NULL DEFAULT 'OFFLINE',
    "version" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "sessionValid" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collector_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawler_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "CrawlerMode" NOT NULL,
    "collectorType" "CollectorType" NOT NULL,
    "collectorAgentId" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "topN" INTEGER,
    "csvFileId" TEXT,
    "status" "CrawlerTaskStatus" NOT NULL DEFAULT 'PENDING',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "bullJobId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawler_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawler_task_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "skuId" TEXT,
    "status" "CrawlerItemStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetry" INTEGER NOT NULL DEFAULT 3,
    "failCode" TEXT,
    "failReason" TEXT,
    "assignedAgentId" TEXT,
    "bullJobId" TEXT,
    "crawledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawler_task_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawler_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "itemId" TEXT,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "stage" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawler_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskItemId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "mainImageUrl" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "specs" JSONB NOT NULL,
    "categoryPath" TEXT,
    "rating" DECIMAL(3,2),
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "skuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "mainImageUrl" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "specs" JSONB NOT NULL,
    "categoryPath" TEXT,
    "rating" DECIMAL(3,2),
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'CRAWLED',
    "remark" TEXT,
    "onShelfAt" TIMESTAMP(3),
    "offShelfAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_selections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "productId" TEXT,
    "status" "AiSelectionStatus" NOT NULL DEFAULT 'QUEUED',
    "score" INTEGER,
    "profitEstimate" DECIMAL(12,2),
    "profitCurrency" TEXT NOT NULL DEFAULT 'RUB',
    "riskPoints" JSONB,
    "fitReason" TEXT,
    "unfitReason" TEXT,
    "recommended" BOOLEAN,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "rawResponse" JSONB,
    "errorMessage" TEXT,
    "bullJobId" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "remark" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receiverName" TEXT NOT NULL,
    "receiverPhone" TEXT NOT NULL,
    "receiverCountry" TEXT NOT NULL DEFAULT 'RU',
    "receiverRegion" TEXT,
    "receiverCity" TEXT NOT NULL,
    "receiverAddress" TEXT NOT NULL,
    "receiverPostalCode" TEXT,
    "remark" TEXT,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'CREATED',
    "outboundTrackingNo" TEXT,
    "outboundCarrier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseNo" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ozonOrderNo" TEXT,
    "wbTrackingNo" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'PENDING_PURCHASE',
    "failReason" TEXT,
    "platformAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_tracks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "relatedType" "LogisticsRelatedType" NOT NULL,
    "relatedId" TEXT NOT NULL,
    "nodeCode" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "relatedType" "LogisticsRelatedType" NOT NULL,
    "relatedId" TEXT NOT NULL,
    "level" "AlertLevel" NOT NULL DEFAULT 'WARNING',
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "orderLinkId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "inboundNo" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "operatorId" TEXT NOT NULL,
    "inboundAt" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbound_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "inboundRecordId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "trackingNo" TEXT NOT NULL,
    "carrier" TEXT,
    "operatorId" TEXT NOT NULL,
    "outboundAt" TIMESTAMP(3) NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bizType" "FileBizType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "tenant_configs_tenantId_idx" ON "tenant_configs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_configs_tenantId_key_key" ON "tenant_configs"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_type_idx" ON "permissions"("type");

-- CreateIndex
CREATE INDEX "user_roles_tenantId_idx" ON "user_roles"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "platform_accounts_tenantId_platform_idx" ON "platform_accounts"("tenantId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "platform_accounts_tenantId_platform_name_key" ON "platform_accounts"("tenantId", "platform", "name");

-- CreateIndex
CREATE INDEX "collector_agents_tenantId_status_idx" ON "collector_agents"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "collector_agents_tenantId_agentKey_key" ON "collector_agents"("tenantId", "agentKey");

-- CreateIndex
CREATE INDEX "crawler_tasks_tenantId_status_createdAt_idx" ON "crawler_tasks"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "crawler_tasks_tenantId_collectorType_idx" ON "crawler_tasks"("tenantId", "collectorType");

-- CreateIndex
CREATE INDEX "crawler_task_items_tenantId_status_idx" ON "crawler_task_items"("tenantId", "status");

-- CreateIndex
CREATE INDEX "crawler_task_items_taskId_status_idx" ON "crawler_task_items"("taskId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crawler_task_items_taskId_sourceUrl_key" ON "crawler_task_items"("taskId", "sourceUrl");

-- CreateIndex
CREATE INDEX "crawler_logs_tenantId_taskId_createdAt_idx" ON "crawler_logs"("tenantId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "crawler_logs_itemId_idx" ON "crawler_logs"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "product_snapshots_taskItemId_key" ON "product_snapshots"("taskItemId");

-- CreateIndex
CREATE INDEX "product_snapshots_tenantId_skuId_idx" ON "product_snapshots"("tenantId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "products_snapshotId_key" ON "products"("snapshotId");

-- CreateIndex
CREATE INDEX "products_tenantId_status_idx" ON "products"("tenantId", "status");

-- CreateIndex
CREATE INDEX "products_tenantId_name_idx" ON "products"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_skuId_key" ON "products"("tenantId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_selections_snapshotId_key" ON "ai_selections"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_selections_productId_key" ON "ai_selections"("productId");

-- CreateIndex
CREATE INDEX "ai_selections_tenantId_status_idx" ON "ai_selections"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_selections_tenantId_score_idx" ON "ai_selections"("tenantId", "score");

-- CreateIndex
CREATE INDEX "product_reviews_tenantId_productId_createdAt_idx" ON "product_reviews"("tenantId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_orders_tenantId_status_createdAt_idx" ON "sales_orders"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "sales_orders_tenantId_skuId_idx" ON "sales_orders"("tenantId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenantId_orderNo_key" ON "sales_orders"("tenantId", "orderNo");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_status_idx" ON "purchase_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_skuId_idx" ON "purchase_orders"("tenantId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_purchaseNo_key" ON "purchase_orders"("tenantId", "purchaseNo");

-- CreateIndex
CREATE INDEX "order_links_tenantId_idx" ON "order_links"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "order_links_salesOrderId_key" ON "order_links"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "order_links_purchaseOrderId_key" ON "order_links"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "order_links_tenantId_salesOrderId_purchaseOrderId_skuId_key" ON "order_links"("tenantId", "salesOrderId", "purchaseOrderId", "skuId");

-- CreateIndex
CREATE INDEX "logistics_tracks_tenantId_relatedType_relatedId_occurredAt_idx" ON "logistics_tracks"("tenantId", "relatedType", "relatedId", "occurredAt");

-- CreateIndex
CREATE INDEX "order_alerts_tenantId_status_createdAt_idx" ON "order_alerts"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "order_alerts_tenantId_relatedType_relatedId_idx" ON "order_alerts"("tenantId", "relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_type_idx" ON "warehouses"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenantId_code_key" ON "warehouses"("tenantId", "code");

-- CreateIndex
CREATE INDEX "inbound_records_tenantId_orderLinkId_idx" ON "inbound_records"("tenantId", "orderLinkId");

-- CreateIndex
CREATE INDEX "inbound_records_tenantId_salesOrderId_idx" ON "inbound_records"("tenantId", "salesOrderId");

-- CreateIndex
CREATE INDEX "inbound_records_tenantId_purchaseOrderId_idx" ON "inbound_records"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_records_tenantId_inboundNo_key" ON "inbound_records"("tenantId", "inboundNo");

-- CreateIndex
CREATE INDEX "outbound_records_tenantId_salesOrderId_idx" ON "outbound_records"("tenantId", "salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_records_tenantId_trackingNo_key" ON "outbound_records"("tenantId", "trackingNo");

-- CreateIndex
CREATE INDEX "file_objects_tenantId_bizType_createdAt_idx" ON "file_objects"("tenantId", "bizType", "createdAt");

-- AddForeignKey
ALTER TABLE "tenant_configs" ADD CONSTRAINT "tenant_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "permissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collector_agents" ADD CONSTRAINT "collector_agents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_tasks" ADD CONSTRAINT "crawler_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_tasks" ADD CONSTRAINT "crawler_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_tasks" ADD CONSTRAINT "crawler_tasks_collectorAgentId_fkey" FOREIGN KEY ("collectorAgentId") REFERENCES "collector_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_tasks" ADD CONSTRAINT "crawler_tasks_csvFileId_fkey" FOREIGN KEY ("csvFileId") REFERENCES "file_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_task_items" ADD CONSTRAINT "crawler_task_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_task_items" ADD CONSTRAINT "crawler_task_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "crawler_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_task_items" ADD CONSTRAINT "crawler_task_items_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "collector_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_logs" ADD CONSTRAINT "crawler_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_logs" ADD CONSTRAINT "crawler_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "crawler_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawler_logs" ADD CONSTRAINT "crawler_logs_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "crawler_task_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_snapshots" ADD CONSTRAINT "product_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_snapshots" ADD CONSTRAINT "product_snapshots_taskItemId_fkey" FOREIGN KEY ("taskItemId") REFERENCES "crawler_task_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "product_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_selections" ADD CONSTRAINT "ai_selections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_selections" ADD CONSTRAINT "ai_selections_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "product_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_selections" ADD CONSTRAINT "ai_selections_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "platform_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_links" ADD CONSTRAINT "order_links_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_tracks" ADD CONSTRAINT "logistics_tracks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_alerts" ADD CONSTRAINT "order_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_alerts" ADD CONSTRAINT "order_alerts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_records" ADD CONSTRAINT "inbound_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_records" ADD CONSTRAINT "inbound_records_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_records" ADD CONSTRAINT "inbound_records_orderLinkId_fkey" FOREIGN KEY ("orderLinkId") REFERENCES "order_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_records" ADD CONSTRAINT "inbound_records_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_records" ADD CONSTRAINT "inbound_records_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_records" ADD CONSTRAINT "inbound_records_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_records" ADD CONSTRAINT "outbound_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_records" ADD CONSTRAINT "outbound_records_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_records" ADD CONSTRAINT "outbound_records_inboundRecordId_fkey" FOREIGN KEY ("inboundRecordId") REFERENCES "inbound_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_records" ADD CONSTRAINT "outbound_records_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_records" ADD CONSTRAINT "outbound_records_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
