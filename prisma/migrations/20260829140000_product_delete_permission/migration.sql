-- 商品库物理删除权限

INSERT INTO "permissions" ("id", "code", "name", "type", "resource", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'product:delete', '删除商品', 'ACTION'::"PermissionType", 'product:delete', 540, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."code" = 'product:delete');

INSERT INTO "role_permissions" ("roleId", "permissionId", "assignedAt")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
INNER JOIN "permissions" p ON p."code" = 'product:delete'
WHERE r."code" IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATOR')
ON CONFLICT DO NOTHING;
