import { dedupeVariants, ensureWeightVariant, fillSkuOptionsFromVariants } from '@aiecom/shared';
import { PageResult, request } from './request';

export type ProductSpec = { name: string; value: string };

export type ProductVariantValue = {
  value: string;
  selected?: boolean;
  skuId?: string;
  sourceUrl?: string;
  price?: number;
  imageUrls?: string[];
};

export type ProductVariant = {
  name: string;
  values: ProductVariantValue[];
};

export type ProductSkuOption = {
  skuId: string;
  name: string;
  sourceUrl: string;
  price: number;
  originalPrice?: number;
  discountPrice?: number;
  imageUrls: string[];
  options: Record<string, string>;
};

export type Product = {
  id: string;
  skuId: string;
  name: string;
  sourceUrl: string;
  mainImageUrl?: string | null;
  imageUrls?: string[];
  videoUrls?: string[];
  specs?: ProductSpec[] | unknown;
  variants?: ProductVariant[] | unknown;
  skuOptions?: ProductSkuOption[] | unknown;
  price: string;
  originalPrice?: string | null;
  discountPrice?: string | null;
  currency?: string;
  stock: number;
  warehouseType?: 'FBO' | 'FBS' | 'MIXED' | null;
  fboStock?: number | null;
  fbsStock?: number | null;
  status: string;
  brand?: string | null;
  categoryPath?: string | null;
  rating: string | null;
  reviewCount?: number;
  salesCount: number;
  description?: string | null;
  remark: string | null;
  aiSelection?: {
    score: number | null;
    profitEstimate: string | null;
    riskPoints: string[] | null;
    fitReason: string | null;
    unfitReason: string | null;
    recommended: boolean | null;
  } | null;
  wbNmId?: number | null;
  wbImtId?: number | null;
  wbVendorCode?: string | null;
  wbSubjectId?: number | null;
  wbSubjectName?: string | null;
  wbListingStatus?: 'NONE' | 'QUEUED' | 'PROCESSING' | 'LISTED' | 'FAILED' | 'UNLISTED' | null;
  wbListingError?: string | null;
  wbListedAt?: string | null;
  shopListings?: ProductShopListing[];
};

export type ProductShopListing = {
  id: string;
  shopId: string;
  status: NonNullable<Product['wbListingStatus']>;
  error?: string | null;
  wbNmId?: number | null;
  wbVendorCode?: string | null;
  listedAt?: string | null;
  shop?: { id: string; name: string; platform: string; status: string } | null;
};

export const WB_LISTING_STATUS_TEXT: Record<NonNullable<Product['wbListingStatus']>, string> = {
  NONE: '未上架',
  QUEUED: '排队中',
  PROCESSING: '建卡中',
  LISTED: '已建卡',
  FAILED: '上架失败',
  UNLISTED: '已回收',
};

export {
  canDeleteProduct,
  canShelfProduct,
  canShowOffShelfAction,
  canShowOnShelfAction,
  canUnlistListing,
  canUnlistProduct,
  isProductListingBusy,
  isWbListingBusy,
} from './listing-status';

export function productSpecs(product: Product): ProductSpec[] {
  if (!Array.isArray(product.specs)) {
    return [];
  }
  return product.specs.filter(
    (item): item is ProductSpec =>
      Boolean(item) && typeof item === 'object' && typeof item.name === 'string' && typeof item.value === 'string',
  );
}

export function productDescription(product: Product): string {
  return product.description || productSpecs(product).find((item) => item.name === '商品描述')?.value || '';
}

function rawVariants(product: Product): ProductVariant[] {
  if (!Array.isArray(product.variants)) {
    return [];
  }
  return dedupeVariants(
    product.variants.filter(
      (item): item is ProductVariant =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof item.name === 'string' &&
        Array.isArray(item.values),
    ),
  );
}

export function productSkuOptions(product: Product): ProductSkuOption[] {
  const raw = Array.isArray(product.skuOptions)
    ? product.skuOptions.filter(
        (item): item is ProductSkuOption => Boolean(item) && typeof item === 'object' && typeof item.skuId === 'string',
      )
    : [];
  if (raw.length) {
    return raw.map((item) => ({
      ...item,
      imageUrls: item.imageUrls || [],
      options: item.options || {},
    }));
  }
  return fillSkuOptionsFromVariants({
    skuId: product.skuId,
    name: product.name,
    sourceUrl: product.sourceUrl,
    price: Number(product.price) || 0,
    imageUrls: product.imageUrls,
    variants: [],
    skuOptions: [],
  });
}

export function productVariants(product: Product): ProductVariant[] {
  return ensureWeightVariant(rawVariants(product), productSkuOptions(product));
}

export function fetchProducts(params: {
  current?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  catalogOnly?: boolean;
  wbListingStatus?: string;
  categoryPath?: string;
  shopId?: string;
  recommended?: boolean;
}) {
  const query = new URLSearchParams();
  query.set('page', String(params.current ?? 1));
  query.set('pageSize', String(params.pageSize ?? 20));
  if (params.keyword) query.set('keyword', params.keyword);
  if (params.status) query.set('status', params.status);
  if (params.catalogOnly) query.set('catalogOnly', 'true');
  if (params.wbListingStatus) query.set('wbListingStatus', params.wbListingStatus);
  if (params.categoryPath) query.set('categoryPath', params.categoryPath);
  if (params.shopId) query.set('shopId', params.shopId);
  if (params.recommended === true) query.set('recommended', 'true');
  if (params.recommended === false) query.set('recommended', 'false');
  return request<PageResult<Product>>(`/api/v1/products?${query.toString()}`);
}

export type PriceSource = 'original' | 'discount' | 'sale';

export type ShelfPriceMode =
  | 'keep'
  | 'from_sources'
  | 'dual_times'
  | 'fixed_list_discount'
  | 'fixed_list_sale'
  | 'fixed_sale_discount'
  | 'original_times'
  | 'sale_times'
  | 'fixed';

export type ShelfPayload = {
  onShelf: boolean;
  shopIds: string[];
  price?: number;
  stock?: number;
  priceMode?: ShelfPriceMode;
  priceMultiplier?: number;
  saleMultiplier?: number;
  listSource?: PriceSource;
  saleSource?: PriceSource;
  fixedPrice?: number;
  listPrice?: number;
  salePrice?: number;
  discountPercent?: number;
  fixedListPrice?: number;
  fixedSalePrice?: number;
  fixedDiscountPercent?: number;
  skuIds?: string[];
  wbSubjectId?: number;
  wbSubjectName?: string;
  sized?: boolean | null;
};

export function updateProduct(id: string, body: { name?: string; price?: number; stock?: number; remark?: string }) {
  return request(`/api/v1/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function shelfProduct(id: string, body: ShelfPayload) {
  return request<Product>(`/api/v1/products/${id}/shelf`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function shelfProductsBatch(productIds: string[], body: ShelfPayload) {
  return request<{ count: number }>('/api/v1/products/shelf/batch', {
    method: 'POST',
    body: JSON.stringify({ ...body, productIds }),
  });
}

export function deleteProduct(id: string) {
  return request<{ count: number }>(`/api/v1/products/${id}`, { method: 'DELETE' });
}

export function deleteProductsBatch(ids: string[]) {
  return request<{ count: number }>('/api/v1/products/delete/batch', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export type PackageEstimate = {
  length?: number;
  width?: number;
  height?: number;
  weightBrutto?: number;
  confidence: number;
  categoryHint: string;
  reason: string;
  assumptions: string[];
  source: string;
  model: string;
};

export type PackageEstimateResult = {
  product: Product;
  estimate: PackageEstimate;
  gaps: {
    dimensions: { length?: number; width?: number; height?: number; weightBrutto?: number };
    missingSize: boolean;
    missingWeight: boolean;
  };
  persisted: boolean;
  skipped: boolean;
};

export type PackageEstimateBatchItem = {
  productId: string;
  skuId: string;
  name: string;
  ok: boolean;
  skipped?: boolean;
  persisted?: boolean;
  error?: string;
  estimate?: PackageEstimate;
  gaps?: PackageEstimateResult['gaps'];
};

export function estimateProductPackage(id: string, body: { persist?: boolean; force?: boolean } = {}) {
  return request<PackageEstimateResult>(`/api/v1/products/${id}/package-estimate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function estimateProductPackageBatch(
  productIds: string[],
  body: { persist?: boolean; force?: boolean } = {},
) {
  return request<{ list: PackageEstimateBatchItem[] }>('/api/v1/products/package-estimate/batch', {
    method: 'POST',
    body: JSON.stringify({ ...body, productIds }),
  });
}

export type WbShelfPricePreview = {
  listPrice: number;
  salePrice: number;
  discount: number;
};

function clampDiscount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(99, Math.max(0, Math.round(value)));
}

function discountFromListAndSale(listPrice: number, salePrice: number): number {
  const list = Math.max(1, Math.round(listPrice));
  const sale = Math.max(1, Math.round(salePrice));
  if (sale >= list) return 0;
  return clampDiscount((1 - sale / list) * 100);
}

function saleFromListAndDiscount(listPrice: number, discountPercent: number): number {
  const list = Math.max(1, Math.round(listPrice));
  const discount = clampDiscount(discountPercent);
  return Math.max(1, Math.round(list * (1 - discount / 100)));
}

function listFromSaleAndDiscount(salePrice: number, discountPercent: number): number {
  const sale = Math.max(1, Math.round(salePrice));
  const discount = clampDiscount(discountPercent);
  if (discount <= 0) return sale;
  if (discount >= 99) return Math.max(sale * 100, sale);
  return Math.max(sale, Math.round(sale / (1 - discount / 100)));
}

function normalizePair(listPrice: number, salePrice: number): WbShelfPricePreview {
  let list = Math.max(1, Math.round(listPrice));
  let sale = Math.max(1, Math.round(salePrice));
  if (sale > list) list = sale;
  const discount = discountFromListAndSale(list, sale);
  sale = saleFromListAndDiscount(list, discount);
  if (sale > list) sale = list;
  return { listPrice: list, salePrice: sale, discount };
}

/** 单品三字段联动（与后端 resolveManualShelfPrice 对齐） */
export function linkShelfPriceFields(
  edited: 'list' | 'sale' | 'discount',
  values: { listPrice: number; salePrice: number; discountPercent: number },
): WbShelfPricePreview {
  const list = Math.max(1, Math.round(values.listPrice || 1));
  const sale = Math.max(1, Math.round(values.salePrice || 1));
  const discount = clampDiscount(values.discountPercent);
  if (edited === 'list' || edited === 'discount') {
    return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
  }
  // edited sale → 保持原价，反算折扣
  const nextList = Math.max(list, sale);
  const nextDiscount = discountFromListAndSale(nextList, sale);
  return {
    listPrice: nextList,
    salePrice: saleFromListAndDiscount(nextList, nextDiscount),
    discount: nextDiscount,
  };
}

export function previewShelfPrice(input: {
  price: number;
  originalPrice?: number | null;
  discountPrice?: number | null;
  mode: ShelfPriceMode;
  multiplier?: number;
  saleMultiplier?: number;
  listSource?: PriceSource;
  saleSource?: PriceSource;
  fixedPrice?: number;
  listPrice?: number;
  salePrice?: number;
  discountPercent?: number;
  fixedListPrice?: number;
  fixedSalePrice?: number;
  fixedDiscountPercent?: number;
}): WbShelfPricePreview {
  const saleBase = Math.max(0, Number(input.price) || 0);
  const discountBase = Math.max(0, Number(input.discountPrice) || saleBase);
  const listBase = Math.max(0, Number(input.originalPrice) || Math.max(discountBase, saleBase));
  const fallbackList = Math.max(1, Math.round(listBase || saleBase || 1));
  const fallbackSale = Math.max(1, Math.round(saleBase || discountBase || listBase || 1));
  const bases = {
    original: listBase || discountBase || saleBase,
    discount: discountBase || saleBase || listBase,
    sale: saleBase || discountBase || listBase,
  };

  if (input.listPrice != null || input.salePrice != null || input.discountPercent != null) {
    if (input.listPrice != null && input.discountPercent != null) {
      const list = Math.max(1, Math.round(input.listPrice));
      const discount = clampDiscount(input.discountPercent);
      return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
    }
    if (input.listPrice != null && input.salePrice != null) {
      return normalizePair(input.listPrice, input.salePrice);
    }
    if (input.salePrice != null && input.discountPercent != null) {
      const sale = Math.max(1, Math.round(input.salePrice));
      const discount = clampDiscount(input.discountPercent);
      const list = listFromSaleAndDiscount(sale, discount);
      return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
    }
  }

  const mode = input.mode || 'keep';
  const listFactor = Number(input.multiplier);
  const factor = Number.isFinite(listFactor) && listFactor > 0 ? listFactor : 1;
  const saleFactorRaw = Number(input.saleMultiplier);
  const saleFactor = Number.isFinite(saleFactorRaw) && saleFactorRaw > 0 ? saleFactorRaw : factor;
  const pick = (source?: PriceSource) => {
    if (source === 'original') return bases.original || bases.discount || bases.sale;
    if (source === 'discount') return bases.discount || bases.sale || bases.original;
    return bases.sale || bases.discount || bases.original;
  };

  if (mode === 'from_sources' || mode === 'keep') {
    const listSrc: PriceSource = mode === 'keep' ? 'original' : input.listSource || 'original';
    const saleSrc: PriceSource = mode === 'keep' ? 'sale' : input.saleSource || 'sale';
    const listMult = mode === 'keep' ? 1 : factor;
    const saleMult = mode === 'keep' ? 1 : saleFactor;
    return normalizePair(pick(listSrc) * listMult, Math.min(pick(listSrc) * listMult, pick(saleSrc) * saleMult));
  }
  if (mode === 'dual_times' || mode === 'original_times' || mode === 'sale_times') {
    return normalizePair(fallbackList * factor, Math.min(fallbackList * factor, fallbackSale * factor));
  }
  if (mode === 'fixed_list_discount') {
    const list = Math.max(1, Math.round(Number(input.fixedListPrice) || fallbackList));
    const discount = clampDiscount(Number(input.fixedDiscountPercent) || 0);
    return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
  }
  if (mode === 'fixed_list_sale') {
    return normalizePair(
      Number(input.fixedListPrice) || fallbackList,
      Number(input.fixedSalePrice) || fallbackSale,
    );
  }
  if (mode === 'fixed_sale_discount') {
    const sale = Math.max(1, Math.round(Number(input.fixedSalePrice) || fallbackSale));
    const discount = clampDiscount(Number(input.fixedDiscountPercent) || 0);
    const list = listFromSaleAndDiscount(sale, discount);
    return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
  }
  if (mode === 'fixed') {
    const fixed = Math.max(1, Math.round(Number(input.fixedPrice) || fallbackSale));
    return normalizePair(fixed, fixed);
  }
  return normalizePair(fallbackList, Math.min(fallbackList, fallbackSale));
}
