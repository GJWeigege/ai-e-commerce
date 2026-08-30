-- 下线选品复审菜单与操作权限

DELETE FROM "user_permissions"
WHERE "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('menu:product-review', 'product:review'));

DELETE FROM "role_permissions"
WHERE "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('menu:product-review', 'product:review'));

DELETE FROM "permissions"
WHERE "code" IN ('menu:product-review', 'product:review');
