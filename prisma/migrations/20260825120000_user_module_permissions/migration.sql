-- 操作员按人分配模块权限

CREATE TABLE "user_permissions" (
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("userId","permissionId")
);

CREATE INDEX "user_permissions_tenantId_idx" ON "user_permissions"("tenantId");

ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 已有操作员默认保留全部操作员模块，避免升级后菜单突然消失
INSERT INTO "user_permissions" ("userId", "permissionId", "tenantId", "assignedAt")
SELECT u."id", p."id", u."tenantId", CURRENT_TIMESTAMP
FROM "users" u
INNER JOIN "user_roles" ur ON ur."userId" = u."id"
INNER JOIN "roles" r ON r."id" = ur."roleId" AND r."code" = 'OPERATOR'
INNER JOIN "permissions" p ON p."code" IN (
  'menu:dashboard', 'menu:crawler', 'menu:product', 'menu:order', 'menu:warehouse', 'menu:trace'
)
WHERE u."tenantId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "permissions" ("id", "code", "name", "type", "resource", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v.code, v.name, v.type::"PermissionType", v.resource, v.sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  VALUES
    ('menu:role', '角色权限', 'MENU', '/iam/roles', 25),
    ('role:list', '查看角色', 'ACTION', 'role:list', 240)
) AS v(code, name, type, resource, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = v.code);

INSERT INTO "role_permissions" ("roleId", "permissionId", "assignedAt")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
INNER JOIN "permissions" p ON p."code" IN ('menu:role', 'role:list')
WHERE r."code" = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;
