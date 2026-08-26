import { PageResult, request } from './request';

export type SysUser = {
  id: string;
  username: string;
  realName: string | null;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'DISABLED';
  tenantId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  tenant?: { id: string; name: string; code: string } | null;
  userRoles: Array<{ role: { code: string; name: string } }>;
  shopAccesses?: Array<{ shopId: string; shop: { id: string; name: string; platform: string; status: string } }>;
  moduleAccesses?: Array<{ permission: { code: string; name: string } }>;
};

export type RoleOption = { id: string; code: string; name: string };

export type RoleCatalogItem = {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  permissions: Array<{ code: string; name: string; type: string; resource: string; sortOrder: number }>;
};

export function fetchUsers(params: { current?: number; pageSize?: number; keyword?: string; status?: string }) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.status) query.set('status', params.status);
  return request<PageResult<SysUser>>(`/api/v1/users?${query.toString()}`);
}

export function createUser(body: {
  username: string;
  password: string;
  realName?: string;
  email?: string;
  phone?: string;
  roleCode: string;
  tenantId?: string;
  shopIds?: string[];
  moduleCodes?: string[];
}) {
  return request('/api/v1/users', { method: 'POST', body: JSON.stringify(body) });
}

export function updateUser(
  id: string,
  body: Partial<Pick<SysUser, 'realName' | 'email' | 'phone' | 'status'>> & {
    shopIds?: string[];
    moduleCodes?: string[];
  },
) {
  return request(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function fetchRoles() {
  return request<RoleOption[]>('/api/v1/roles');
}

export function fetchRoleCatalog() {
  return request<RoleCatalogItem[]>('/api/v1/roles/catalog');
}
