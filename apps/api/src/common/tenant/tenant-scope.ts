export class CrossTenantException extends Error {
  readonly code = 'CROSS_TENANT_FORBIDDEN';

  constructor(message = '禁止跨租户访问') {
    super(message);
    this.name = 'CrossTenantException';
  }
}

export class TenantRequiredException extends Error {
  readonly code = 'TENANT_REQUIRED';

  constructor(message = '缺少租户上下文') {
    super(message);
    this.name = 'TenantRequiredException';
  }
}

export class AccountUnboundException extends Error {
  readonly code = 'ACCOUNT_NOT_BOUND_TO_TENANT';

  constructor(message = '账号未绑定租户') {
    super(message);
    this.name = 'AccountUnboundException';
  }
}

export type ResolveTenantInput = {
  userTenantId: string | null;
  isSuperAdmin: boolean;
  headerTenantId?: string;
};

/**
 * 从 JWT 租户与请求头解析本次请求的租户。
 * 超管可凭 X-Tenant-Id 切换工作租户；普通用户禁止切换到其他租户。
 */
export function resolveRequestTenantId(input: ResolveTenantInput): string | null {
  if (input.isSuperAdmin) {
    return input.headerTenantId ?? null;
  }
  if (!input.userTenantId) {
    throw new AccountUnboundException();
  }
  if (input.headerTenantId && input.headerTenantId !== input.userTenantId) {
    throw new CrossTenantException();
  }
  return input.userTenantId;
}

export function requireTenantId(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new TenantRequiredException('该操作必须指定租户');
  }
  return tenantId;
}

export function assertTenantMatch(rowTenantId: string, requestTenantId: string): void {
  if (rowTenantId !== requestTenantId) {
    throw new CrossTenantException();
  }
}

export function canAssignRole(actorRoles: string[], targetRole: string): boolean {
  if (actorRoles.includes('SUPER_ADMIN')) {
    return targetRole === 'TENANT_ADMIN' || targetRole === 'OPERATOR';
  }
  if (actorRoles.includes('TENANT_ADMIN')) {
    return targetRole === 'OPERATOR' || targetRole === 'TENANT_ADMIN';
  }
  return false;
}

/** 超管与租户管理员可操作本租户全部店铺，不必再做店铺绑定 */
export function canAccessAllTenantShops(roles: string[]): boolean {
  return roles.includes('SUPER_ADMIN') || roles.includes('TENANT_ADMIN');
}

/** 店铺额度开通/改绑仅超管可做，防止租户用一个额度自行换店 */
export function canManageTenantShops(roles: string[]): boolean {
  return roles.includes('SUPER_ADMIN');
}
