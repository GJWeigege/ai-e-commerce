import { PageResult, request } from './request';

export type Tenant = {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  isolationMode: 'SHARED' | 'DEDICATED';
  remark: string | null;
  createdAt: string;
};

export function fetchTenants(params: { current?: number; pageSize?: number; keyword?: string; status?: string }) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.status) query.set('status', params.status);
  return request<PageResult<Tenant>>(`/api/v1/tenants?${query.toString()}`);
}

export function fetchTenantOptions() {
  return request<Tenant[]>('/api/v1/tenants/options');
}

export function createTenant(body: { name: string; code: string; remark?: string }) {
  return request<Tenant>('/api/v1/tenants', { method: 'POST', body: JSON.stringify(body) });
}

export function updateTenant(id: string, body: { name?: string; remark?: string }) {
  return request<Tenant>(`/api/v1/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function changeTenantStatus(id: string, status: Tenant['status']) {
  return request<Tenant>(`/api/v1/tenants/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
