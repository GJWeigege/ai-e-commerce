export const ROLE_CODES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPERATOR'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSION_TYPES = ['MENU', 'DATA', 'ACTION'] as const;
export type PermissionType = (typeof PERMISSION_TYPES)[number];

export interface PermissionDef {
  code: string;
  name: string;
  type: PermissionType;
  resource: string;
  parentCode?: string;
  sortOrder: number;
}

export const PERMISSIONS: PermissionDef[] = [
  { code: 'menu:dashboard', name: '工作台', type: 'MENU', resource: '/dashboard', sortOrder: 10 },
  { code: 'menu:tenant', name: '租户管理', type: 'MENU', resource: '/iam/tenants', sortOrder: 20 },
  { code: 'menu:role', name: '角色权限', type: 'MENU', resource: '/iam/roles', sortOrder: 25 },
  { code: 'menu:user', name: '用户管理', type: 'MENU', resource: '/iam/users', sortOrder: 30 },
  { code: 'menu:shop', name: '店铺管理', type: 'MENU', resource: '/iam/shops', sortOrder: 35 },
  { code: 'menu:crawler', name: '采集任务', type: 'MENU', resource: '/crawler/tasks', sortOrder: 40 },
  { code: 'menu:product', name: '商品库', type: 'MENU', resource: '/product/catalog', sortOrder: 60 },
  { code: 'menu:order', name: '订单中心', type: 'MENU', resource: '/order', sortOrder: 70 },
  { code: 'menu:warehouse', name: '仓储履约', type: 'MENU', resource: '/warehouse', sortOrder: 80 },
  { code: 'menu:trace', name: '全链路追踪', type: 'MENU', resource: '/trace', sortOrder: 90 },

  { code: 'data:tenant:all', name: '全部租户数据', type: 'DATA', resource: 'tenant:*', sortOrder: 100 },
  { code: 'data:tenant:self', name: '本租户数据', type: 'DATA', resource: 'tenant:self', sortOrder: 110 },

  { code: 'tenant:list', name: '查看租户', type: 'ACTION', resource: 'tenant:list', sortOrder: 200 },
  { code: 'tenant:create', name: '创建租户', type: 'ACTION', resource: 'tenant:create', sortOrder: 210 },
  { code: 'tenant:update', name: '编辑租户', type: 'ACTION', resource: 'tenant:update', sortOrder: 220 },
  { code: 'tenant:disable', name: '停用租户', type: 'ACTION', resource: 'tenant:disable', sortOrder: 230 },
  { code: 'role:list', name: '查看角色', type: 'ACTION', resource: 'role:list', sortOrder: 240 },

  { code: 'user:list', name: '查看用户', type: 'ACTION', resource: 'user:list', sortOrder: 300 },
  { code: 'user:create', name: '创建用户', type: 'ACTION', resource: 'user:create', sortOrder: 310 },
  { code: 'user:update', name: '编辑用户', type: 'ACTION', resource: 'user:update', sortOrder: 320 },
  { code: 'user:disable', name: '停用用户', type: 'ACTION', resource: 'user:disable', sortOrder: 330 },

  { code: 'shop:list', name: '查看店铺', type: 'ACTION', resource: 'shop:list', sortOrder: 340 },
  { code: 'shop:create', name: '开通店铺（仅超管）', type: 'ACTION', resource: 'shop:create', sortOrder: 350 },
  { code: 'shop:update', name: '编辑店铺（仅超管）', type: 'ACTION', resource: 'shop:update', sortOrder: 360 },
  { code: 'shop:disable', name: '停用店铺（仅超管）', type: 'ACTION', resource: 'shop:disable', sortOrder: 370 },

  { code: 'crawler:task:list', name: '查看采集任务', type: 'ACTION', resource: 'crawler:task:list', sortOrder: 400 },
  { code: 'crawler:task:create', name: '创建采集任务', type: 'ACTION', resource: 'crawler:task:create', sortOrder: 410 },
  { code: 'crawler:task:retry', name: '重试采集任务', type: 'ACTION', resource: 'crawler:task:retry', sortOrder: 420 },
  { code: 'crawler:task:export', name: '导出采集结果', type: 'ACTION', resource: 'crawler:task:export', sortOrder: 430 },

  { code: 'product:list', name: '查看商品', type: 'ACTION', resource: 'product:list', sortOrder: 500 },
  { code: 'product:edit', name: '编辑商品', type: 'ACTION', resource: 'product:edit', sortOrder: 520 },
  { code: 'product:shelf', name: '上下架商品', type: 'ACTION', resource: 'product:shelf', sortOrder: 530 },
  { code: 'product:delete', name: '删除商品', type: 'ACTION', resource: 'product:delete', sortOrder: 540 },

  { code: 'order:list', name: '查看订单', type: 'ACTION', resource: 'order:list', sortOrder: 600 },
  { code: 'order:create', name: '创建销售单', type: 'ACTION', resource: 'order:create', sortOrder: 610 },
  { code: 'order:batch', name: '批量操作订单', type: 'ACTION', resource: 'order:batch', sortOrder: 620 },
  { code: 'order:alert', name: '处理订单告警', type: 'ACTION', resource: 'order:alert', sortOrder: 630 },

  { code: 'warehouse:inbound', name: '入库登记', type: 'ACTION', resource: 'warehouse:inbound', sortOrder: 700 },
  { code: 'warehouse:outbound', name: '出库发货', type: 'ACTION', resource: 'warehouse:outbound', sortOrder: 710 },
];

/** 操作员可勾选的模块 → 自动展开的权限码（含菜单自身） */
export const OPERATOR_MODULE_BUNDLES: Record<string, readonly string[]> = {
  'menu:dashboard': ['menu:dashboard'],
  'menu:crawler': ['menu:crawler', 'crawler:task:list', 'crawler:task:create', 'crawler:task:retry', 'crawler:task:export'],
  'menu:product': ['menu:product', 'product:list', 'product:shelf', 'product:delete', 'shop:list'],
  'menu:order': ['menu:order', 'order:list', 'order:create'],
  'menu:warehouse': ['menu:warehouse', 'warehouse:inbound', 'warehouse:outbound'],
  'menu:trace': ['menu:trace'],
};

export const OPERATOR_MODULE_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'menu:dashboard', name: '工作台' },
  { code: 'menu:crawler', name: '采集任务' },
  { code: 'menu:product', name: '商品库' },
  { code: 'menu:order', name: '订单中心' },
  { code: 'menu:warehouse', name: '仓储履约' },
  { code: 'menu:trace', name: '全链路追踪' },
];

export const OPERATOR_ASSIGNABLE_MODULE_CODES = OPERATOR_MODULE_OPTIONS.map((item) => item.code);

const OPERATOR_BASE_PERMISSIONS = ['data:tenant:self', 'menu:dashboard'] as const;

const OPERATOR_CODES = new Set<string>([
  ...OPERATOR_BASE_PERMISSIONS,
  ...Object.values(OPERATOR_MODULE_BUNDLES).flat(),
]);

const TENANT_ADMIN_EXTRA = [
  'menu:user',
  'menu:shop',
  'user:list',
  'user:create',
  'user:update',
  'user:disable',
  'shop:list',
  'product:edit',
  'order:batch',
  'order:alert',
];

export function permissionCodesForRole(role: RoleCode): string[] {
  if (role === 'SUPER_ADMIN') {
    return PERMISSIONS.map((item) => item.code);
  }
  if (role === 'TENANT_ADMIN') {
    return [...new Set([...OPERATOR_CODES, ...TENANT_ADMIN_EXTRA])];
  }
  return [...OPERATOR_CODES];
}

export function invalidOperatorModules(moduleCodes: string[]): string[] {
  const allowed = new Set(OPERATOR_ASSIGNABLE_MODULE_CODES);
  return [...new Set(moduleCodes)].filter((code) => !allowed.has(code));
}

/** 操作员勾选模块 → 实际生效的权限码；未勾选时仅工作台 + 本租户数据 */
export function expandOperatorModules(moduleCodes: string[]): string[] {
  const allowed = new Set(OPERATOR_ASSIGNABLE_MODULE_CODES);
  const result = new Set<string>(OPERATOR_BASE_PERMISSIONS);
  for (const code of moduleCodes) {
    if (!allowed.has(code)) {
      continue;
    }
    for (const item of OPERATOR_MODULE_BUNDLES[code] ?? []) {
      result.add(item);
    }
  }
  return [...result];
}

/** 登录后的有效权限：超管/租户管理员走角色模板，操作员走按人分配的模块 */
export function resolveEffectivePermissions(roles: RoleCode[], assignedModuleCodes: string[] = []): string[] {
  if (roles.includes('SUPER_ADMIN')) {
    return permissionCodesForRole('SUPER_ADMIN');
  }
  if (roles.includes('TENANT_ADMIN')) {
    return permissionCodesForRole('TENANT_ADMIN');
  }
  return expandOperatorModules(assignedModuleCodes);
}
