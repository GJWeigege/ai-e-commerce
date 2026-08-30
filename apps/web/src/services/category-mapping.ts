import { PageResult, request } from './request';

export type WbCategoryMapSource = 'AUTO' | 'LEARNED' | 'MANUAL';

export type WbCategoryMapping = {
  id: string;
  ozonCategoryKey: string;
  ozonCategoryPath: string;
  wbSubjectId: number;
  wbSubjectName: string;
  /** null 表示尺码口径未知，首次上架后由 WB 结果回写 */
  sized: boolean | null;
  source: WbCategoryMapSource;
  hitCount: number;
  lastError: string | null;
  lastUsedAt: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OzonCategoryUsage = {
  ozonCategoryPath: string;
  productCount: number;
  mapped: boolean;
  wbSubjectName: string | null;
};

export type WbSubjectSuggestion = {
  subjectId: number;
  subjectName: string;
  parentName: string | null;
};

export const CATEGORY_MAP_SOURCE_TEXT: Record<WbCategoryMapSource, string> = {
  AUTO: '自动检索',
  LEARNED: '按 WB 报错自学习',
  MANUAL: '人工指定',
};

export const CATEGORY_MAP_SIZED_TEXT: Record<string, string> = {
  true: '按尺码建卡',
  false: '无尺码商品',
  null: '未知',
};

export function fetchCategoryMappings(params: { current?: number; pageSize?: number; keyword?: string }) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.keyword) query.set('keyword', params.keyword);
  return request<PageResult<WbCategoryMapping>>(`/api/v1/wb-category-mappings?${query.toString()}`);
}

export function fetchOzonCategoryUsage() {
  return request<OzonCategoryUsage[]>('/api/v1/wb-category-mappings/ozon-categories');
}

export function fetchCategoryMappingByPath(ozonCategoryPath: string) {
  const query = new URLSearchParams({ ozonCategoryPath });
  return request<WbCategoryMapping | null>(`/api/v1/wb-category-mappings/resolve?${query.toString()}`);
}

export function suggestWbSubjects(body: {
  shopId: string;
  ozonCategoryPath?: string;
  keyword?: string;
  productName?: string;
}) {
  return request<WbSubjectSuggestion[]>('/api/v1/wb-category-mappings/suggest', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function saveCategoryMapping(body: {
  ozonCategoryPath: string;
  wbSubjectId: number;
  wbSubjectName: string;
  sized?: boolean | null;
  remark?: string;
}) {
  return request<WbCategoryMapping>('/api/v1/wb-category-mappings', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteCategoryMappings(ids: string[]) {
  return request<{ count: number }>('/api/v1/wb-category-mappings/delete/batch', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
