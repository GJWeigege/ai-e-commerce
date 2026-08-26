import { PageResult, request } from './request';

export type SalesOrder = {
  id: string;
  orderNo: string;
  skuId: string;
  quantity: number;
  status: string;
  receiverName: string;
  receiverCity: string;
  outboundTrackingNo: string | null;
  product?: { name: string };
  orderLinks?: Array<{
    purchaseOrder: {
      id: string;
      purchaseNo: string;
      status: string;
      ozonOrderNo: string | null;
      wbTrackingNo: string | null;
    };
  }>;
};

export function fetchSalesOrders(params: { current?: number; pageSize?: number; keyword?: string; status?: string }) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.status) query.set('status', params.status);
  return request<PageResult<SalesOrder>>(`/api/v1/sales-orders?${query.toString()}`);
}

export function createSalesOrder(body: Record<string, unknown>) {
  return request('/api/v1/sales-orders', { method: 'POST', body: JSON.stringify(body) });
}

export function advancePurchase(id: string, fail?: boolean) {
  return request(`/api/v1/purchase-orders/${id}/advance`, { method: 'POST', body: JSON.stringify({ fail }) });
}

export function fetchAlerts(params: { current?: number; pageSize?: number }) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  return request<PageResult<{ id: string; title: string; message: string; status: string; createdAt: string }>>(
    `/api/v1/order-alerts?${query.toString()}`,
  );
}

export function resolveAlert(id: string) {
  return request(`/api/v1/order-alerts/${id}/resolve`, { method: 'PATCH' });
}

export function fetchTrace(orderNo: string) {
  return request(`/api/v1/trace?orderNo=${encodeURIComponent(orderNo)}`);
}

export function fetchWarehouses() {
  return request<Array<{ id: string; name: string; type: string; code: string }>>('/api/v1/warehouse/options');
}

export function fetchInbounds(params: { current?: number; pageSize?: number }) {
  const query = new URLSearchParams({ page: String(params.current ?? 1), pageSize: String(params.pageSize ?? 20) });
  return request<PageResult<Record<string, unknown>>>(`/api/v1/warehouse/inbounds?${query}`);
}

export function createInbound(body: { purchaseOrderId: string; warehouseId: string; quantity: number; remark?: string }) {
  return request('/api/v1/warehouse/inbounds', { method: 'POST', body: JSON.stringify(body) });
}

export function fetchOutbounds(params: { current?: number; pageSize?: number }) {
  const query = new URLSearchParams({ page: String(params.current ?? 1), pageSize: String(params.pageSize ?? 20) });
  return request<PageResult<Record<string, unknown>>>(`/api/v1/warehouse/outbounds?${query}`);
}

export function createOutbound(body: { inboundRecordId: string; trackingNo: string; carrier?: string }) {
  return request('/api/v1/warehouse/outbounds', { method: 'POST', body: JSON.stringify(body) });
}

export function fetchDashboardStats() {
  return request<{
    tasks: number;
    products: number;
    pendingReview: number;
    onShelf: number;
    sales: number;
    openAlerts: number;
    needTenant?: boolean;
  }>('/api/v1/dashboard/stats');
}
