import { StandardProduct } from '@aiecom/shared';

export type CollectorType = 'ELECTRON' | 'CHROME_EXT';

export type CollectorConfig = {
  headless: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  maxRetry: number;
  proxies: string[];
  cookie?: string;
  userAgent?: string;
  /** 为 true 时会跟进每个规格页并写入全部 skuId；默认只保留当前页主 SKU */
  crawlAllSkus: boolean;
  /** Ozon 评分下限（5 分制），不填则不限制 */
  minRating?: number;
  /** 评价数下限 */
  minReviewCount?: number;
  /** 销量下限 */
  minSalesCount?: number;
  /** 价格下限（RUB） */
  minPrice?: number;
  /** 价格上限（RUB） */
  maxPrice?: number;
  /** 仅保留有货商品 */
  inStockOnly?: boolean;
};

export const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  headless: true,
  minDelayMs: 800,
  maxDelayMs: 2200,
  maxRetry: 3,
  proxies: [],
  crawlAllSkus: false,
};

/** 暂时关闭批量跟进全部规格 SKU，只保留当前页主 skuId。改回 true 即可恢复入口与写入逻辑。 */
export const CRAWL_ALL_SKUS_ENABLED = false;

export type CollectContext = {
  tenantId: string;
  taskId: string;
  itemId?: string;
  config: CollectorConfig;
  onLog?: (level: 'INFO' | 'WARN' | 'ERROR', stage: string, message: string, extra?: Record<string, unknown>) => void;
};

export type CategoryTopInput = {
  categoryId?: string;
  categoryName?: string;
  topN: number;
};

export class CaptchaDetectedError extends Error {
  readonly code = 'CAPTCHA_DETECTED';
  constructor(message = '检测到验证码或访问被拦截，任务已挂起待人工处理') {
    super(message);
    this.name = 'CaptchaDetectedError';
  }
}

export class CollectFailedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CollectFailedError';
  }
}

export interface ICollector {
  readonly type: CollectorType;
  collectCategoryTop(input: CategoryTopInput, ctx: CollectContext): Promise<StandardProduct[]>;
  collectByUrl(url: string, ctx: CollectContext): Promise<StandardProduct>;
  /** 只解析真实商品 URL，不拉详情。服务端不再打开浏览器，品类页由 Chrome 插件展开。 */
  listCategoryUrls?(input: CategoryTopInput, ctx: CollectContext): Promise<string[]>;
}

export function mergeCollectorConfig(raw?: Record<string, unknown> | null): CollectorConfig {
  return {
    ...DEFAULT_COLLECTOR_CONFIG,
    ...(raw ?? {}),
    proxies: Array.isArray(raw?.proxies) ? (raw?.proxies as string[]) : DEFAULT_COLLECTOR_CONFIG.proxies,
    crawlAllSkus:
      CRAWL_ALL_SKUS_ENABLED && (raw?.crawlAllSkus === true || raw?.crawlAllSkus === 'true'),
    minRating: optionalBoundNumber(raw?.minRating, 0, 5),
    minReviewCount: optionalBoundNumber(raw?.minReviewCount, 0, 1_000_000, true),
    minSalesCount: optionalBoundNumber(raw?.minSalesCount, 0, 100_000_000, true),
    minPrice: optionalBoundNumber(raw?.minPrice, 0, 100_000_000),
    maxPrice: optionalBoundNumber(raw?.maxPrice, 0, 100_000_000),
    inStockOnly: raw?.inStockOnly === true || raw?.inStockOnly === 'true',
  };
}

function optionalBoundNumber(value: unknown, min: number, max: number, integer = false): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  const clamped = Math.min(max, Math.max(min, n));
  return integer ? Math.round(clamped) : clamped;
}

export function collectFilterMismatch(
  product: {
    rating?: number;
    reviewCount?: number;
    salesCount?: number;
    price?: number;
    stock?: number;
  },
  config: Pick<
    CollectorConfig,
    'minRating' | 'minReviewCount' | 'minSalesCount' | 'minPrice' | 'maxPrice' | 'inStockOnly'
  >,
): string | null {
  if (config.minRating != null && (product.rating ?? 0) < config.minRating) {
    return `评分 ${product.rating ?? 0} 低于下限 ${config.minRating}`;
  }
  if (config.minReviewCount != null && (product.reviewCount ?? 0) < config.minReviewCount) {
    return `评价数 ${product.reviewCount ?? 0} 低于下限 ${config.minReviewCount}`;
  }
  if (config.minSalesCount != null && (product.salesCount ?? 0) < config.minSalesCount) {
    return `销量 ${product.salesCount ?? 0} 低于下限 ${config.minSalesCount}`;
  }
  if (config.minPrice != null && (product.price ?? 0) < config.minPrice) {
    return `价格 ${product.price ?? 0} 低于下限 ${config.minPrice}`;
  }
  if (config.maxPrice != null && (product.price ?? 0) > config.maxPrice) {
    return `价格 ${product.price ?? 0} 高于上限 ${config.maxPrice}`;
  }
  if (config.inStockOnly && (product.stock ?? 0) <= 0) {
    return '库存为 0，已按「仅采集有货」跳过';
  }
  return null;
}
