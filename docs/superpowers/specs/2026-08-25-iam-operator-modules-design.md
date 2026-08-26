# 租户 / 角色 / 操作员模块权限设计

## 决策

- 系统角色仍为三级：`SUPER_ADMIN` / `TENANT_ADMIN` / `OPERATOR`
- 操作员按人勾选模块，写入 `UserPermission`（存菜单码）
- 生效权限：超管/租户管理员用角色模板；操作员 = 勾选模块展开 ∩ 操作员天花板，并始终带 `menu:dashboard` + `data:tenant:self`
- 店铺仍用 `UserShopAccess`，与模块独立
- 超管未选工作租户时可跨租户看租户/用户/角色/店铺；采集/商品/订单仍走工作租户
