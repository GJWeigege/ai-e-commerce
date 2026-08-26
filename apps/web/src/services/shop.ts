import { PageResult, request } from './request';

export type Shop = {
  id: string;
  tenantId: string;
  platform: 'OZON' | 'WILDBERRIES';
  name: string;
  status: 'ENABLED' | 'DISABLED' | 'PLACEHOLDER';
  hasToken: boolean;
  extra: unknown;
  createdAt: string;
  updatedAt: string;
  tenant?: { id: string; name: string; code: string };
};

export const PLATFORM_TEXT: Record<Shop['platform'], string> = {
  OZON: 'Ozon',
  WILDBERRIES: 'Wildberries',
};

export const SHOP_STATUS_TEXT: Record<Shop['status'], string> = {
  ENABLED: '已启用',
  DISABLED: '已停用',
  PLACEHOLDER: '待配置 Token',
};

export function fetchShops(params: {
  current?: number;
  pageSize?: number;
  keyword?: string;
  platform?: Shop['platform'];
  tenantId?: string;
  allTenants?: boolean;
}) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.platform) query.set('platform', params.platform);
  if (params.tenantId) query.set('tenantId', params.tenantId);
  if (params.allTenants) query.set('allTenants', 'true');
  return request<PageResult<Shop>>(`/api/v1/shops?${query.toString()}`);
}

export function fetchShopOptions(platform?: Shop['platform']) {
  const query = new URLSearchParams();
  if (platform) query.set('platform', platform);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<Shop[]>(`/api/v1/shops/options${suffix}`);
}

export function createShop(body: {
  tenantId: string;
  name: string;
  platform: Shop['platform'];
  apiToken?: string;
  wbBrand?: string;
}) {
  return request<Shop>('/api/v1/shops', { method: 'POST', body: JSON.stringify(body) });
}

export function updateShop(id: string, body: { name?: string; apiToken?: string; wbBrand?: string }) {
  return request<Shop>(`/api/v1/shops/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function shopWbBrand(extra: unknown): string {
  if (extra && typeof extra === 'object' && !Array.isArray(extra) && typeof (extra as { brand?: unknown }).brand === 'string') {
    return (extra as { brand: string }).brand;
  }
  return '';
}

export function changeShopStatus(id: string, status: Extract<Shop['status'], 'ENABLED' | 'DISABLED'>) {
  return request<Shop>(`/api/v1/shops/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}
