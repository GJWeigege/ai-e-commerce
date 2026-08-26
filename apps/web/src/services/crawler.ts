import { PageResult, request } from './request';

export type CrawlerTask = {
  id: string;
  name: string;
  mode: 'CATEGORY_TOP' | 'CSV_URL';
  collectorType: 'ELECTRON' | 'CHROME_EXT';
  status: string;
  totalCount: number;
  successCount: number;
  failCount: number;
  categoryName: string | null;
  createdAt: string;
  errorMessage: string | null;
};

export type CrawlerItem = {
  id: string;
  sourceUrl: string;
  skuId: string | null;
  status: string;
  retryCount: number;
  failReason: string | null;
  snapshot?: { name: string; price: string; stock: number } | null;
};

export function fetchCrawlerTasks(params: { current?: number; pageSize?: number; keyword?: string; status?: string }) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.status) query.set('status', params.status);
  return request<PageResult<CrawlerTask>>(`/api/v1/crawler/tasks?${query.toString()}`);
}

export function fetchCrawlerTask(id: string) {
  return request<CrawlerTask & { items: CrawlerItem[]; logs: Array<{ id: string; level: string; stage: string; message: string; createdAt: string }> }>(
    `/api/v1/crawler/tasks/${id}`,
  );
}

export function fetchCrawlerItems(taskId: string, params: { current?: number; pageSize?: number; status?: string }) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.status) query.set('status', params.status);
  return request<PageResult<CrawlerItem>>(`/api/v1/crawler/tasks/${taskId}/items?${query.toString()}`);
}

export function createCategoryTask(body: {
  name: string;
  categoryName?: string;
  categoryId?: string;
  topN: number;
  crawlAllSkus?: boolean;
  minRating?: number;
  minReviewCount?: number;
  minSalesCount?: number;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
}) {
  return request('/api/v1/crawler/tasks/category', { method: 'POST', body: JSON.stringify(body) });
}

export function createCsvTask(form: FormData) {
  return request('/api/v1/crawler/tasks/csv', { method: 'POST', body: form });
}

export function createUrlTask(body: {
  name: string;
  urls: string[];
  crawlAllSkus?: boolean;
  minRating?: number;
  minReviewCount?: number;
  minSalesCount?: number;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
}) {
  return request('/api/v1/crawler/tasks/urls', { method: 'POST', body: JSON.stringify(body) });
}

export function retryFailed(taskId: string) {
  return request(`/api/v1/crawler/tasks/${taskId}/retry-failed`, { method: 'POST' });
}

export function retryItem(itemId: string) {
  return request(`/api/v1/crawler/tasks/items/${itemId}/retry`, { method: 'POST' });
}

export function exportTask(taskId: string) {
  return fetch(`/api/v1/crawler/tasks/${taskId}/export`, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem('aiecom_token') ?? ''}`,
      'X-Tenant-Id': localStorage.getItem('aiecom_tenant') ?? '',
    },
  });
}
