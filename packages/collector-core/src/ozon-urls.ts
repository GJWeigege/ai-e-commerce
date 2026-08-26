const OZON_ORIGIN = 'https://www.ozon.ru';
const PRODUCT_PATH = /\/product\/(?:[^/?#]+-)?(\d{6,})/i;

export function isOzonProductUrl(url: string): boolean {
  return /ozon\.ru\/product\//i.test(String(url || ''));
}

export function isOzonListingUrl(url: string): boolean {
  const raw = String(url || '');
  if (isOzonProductUrl(raw)) {
    return false;
  }
  return /ozon\.ru\/(?:category|search|highlight)\//i.test(raw) || /ozon\.ru\/search\?/i.test(raw);
}

export function normalizeOzonProductUrl(raw: string): string | null {
  const text = String(raw || '').trim();
  if (!text || /\/product\/mock-/i.test(text)) {
    return null;
  }
  const match = text.match(PRODUCT_PATH);
  if (!match) {
    return null;
  }
  const path = match[0].split('?')[0].replace(/\/?$/, '/');
  return `${OZON_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/** 从品类/搜索页 HTML 或任意文本中抽出商品链接，供插件展开后的校验复用 */
export function extractOzonProductUrls(source: string, limit = 50): string[] {
  const matches = String(source || '').match(/\/product\/(?:[^/?#\s"']+-)?\d{6,}/gi) ?? [];
  return pickOzonProductUrls(matches, limit);
}

export function pickOzonProductUrls(raw: string[], topN = 50): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of raw) {
    const url = normalizeOzonProductUrl(item);
    if (!url) {
      continue;
    }
    const sku = url.match(/(\d{6,})\/?$/)?.[1] || url;
    if (seen.has(sku)) {
      continue;
    }
    seen.add(sku);
    urls.push(url);
    if (urls.length >= topN) {
      break;
    }
  }
  return urls;
}

/** 把评分/价格限制写进品类页 query，让 Chrome 插件打开的就是 Ozon 已筛选列表 */
export function applyOzonListingFilters(
  listingUrl: string,
  filters: { minRating?: number; minPrice?: number; maxPrice?: number },
): string {
  const url = new URL(listingUrl);
  if (filters.minRating != null && filters.minRating > 0) {
    url.searchParams.set('rating', String(filters.minRating));
  }
  const minPrice = filters.minPrice != null && filters.minPrice > 0 ? filters.minPrice : undefined;
  const maxPrice = filters.maxPrice != null && filters.maxPrice > 0 ? filters.maxPrice : undefined;
  if (minPrice != null || maxPrice != null) {
    url.searchParams.set('currency_price', `${(minPrice ?? 0).toFixed(3)};${(maxPrice ?? 99_999_999).toFixed(3)}`);
  }
  return url.toString();
}

/** Chrome 插件打开的品类页：优先 ID/完整链接，避免拿中文品类名去 ozon.ru 搜索 */
export function buildOzonCategoryListingUrl(input: { categoryId?: string; categoryName?: string }): string {
  const id = String(input.categoryId || '').trim();
  const name = String(input.categoryName || '').trim();
  const fromId = listingUrlFromValue(id);
  if (fromId) {
    return fromId;
  }
  const fromName = listingUrlFromValue(name);
  if (fromName) {
    return fromName;
  }
  if (name) {
    return `${OZON_ORIGIN}/search/?text=${encodeURIComponent(name)}&from_global=true`;
  }
  throw new Error('请填写品类 ID、品类链接或品类名称');
}

function listingUrlFromValue(raw: string): string | null {
  if (!raw) {
    return null;
  }
  if (/^https?:\/\/(?:www\.)?ozon\.ru\//i.test(raw)) {
    const url = new URL(raw);
    url.hash = '';
    if (/\/product\//i.test(url.pathname)) {
      return null;
    }
    if (!url.pathname.endsWith('/') && !url.search) {
      url.pathname = `${url.pathname}/`;
    }
    if (/\/(?:category|search|highlight)\//i.test(url.pathname) || url.pathname === '/search/') {
      url.search = /\/search\/?/i.test(url.pathname) ? url.search : '';
      return url.toString();
    }
  }
  const slugId = raw.match(/([a-z0-9]+(?:-[a-z0-9]+)+-\d{3,})$/i)?.[1];
  if (slugId) {
    return `${OZON_ORIGIN}/category/${slugId}/`;
  }
  const numeric = raw.match(/^(\d{3,})$/)?.[1] || raw.match(/category\/.*?(\d{3,})\/?$/i)?.[1];
  if (numeric && !/\s/.test(raw)) {
    return `${OZON_ORIGIN}/category/${numeric}/`;
  }
  return null;
}
