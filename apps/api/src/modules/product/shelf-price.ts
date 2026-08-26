/** WB 上架价格策略：产出原价(list) + 折扣% + 折后价(sale) */

export type PriceSource = 'original' | 'discount' | 'sale';

export type ShelfPriceMode =
  | 'keep'
  | 'from_sources'
  | 'dual_times'
  | 'fixed_list_discount'
  | 'fixed_list_sale'
  | 'fixed_sale_discount'
  /** @deprecated 兼容旧前端，等同 dual_times 但只抬原价侧时用 dual_times */
  | 'original_times'
  | 'sale_times'
  | 'fixed';

export type WbShelfPrice = {
  /** 写入 WB 的划线原价 */
  listPrice: number;
  /** 折后价（预览与商品库售价） */
  salePrice: number;
  /** 写入 WB 的卖家折扣 0–99 */
  discount: number;
};

export function clampDiscount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(99, Math.max(0, Math.round(value)));
}

export function discountFromListAndSale(listPrice: number, salePrice: number): number {
  const list = Math.max(1, Math.round(listPrice));
  const sale = Math.max(1, Math.round(salePrice));
  if (sale >= list) {
    return 0;
  }
  return clampDiscount((1 - sale / list) * 100);
}

export function saleFromListAndDiscount(listPrice: number, discountPercent: number): number {
  const list = Math.max(1, Math.round(listPrice));
  const discount = clampDiscount(discountPercent);
  return Math.max(1, Math.round(list * (1 - discount / 100)));
}

export function listFromSaleAndDiscount(salePrice: number, discountPercent: number): number {
  const sale = Math.max(1, Math.round(salePrice));
  const discount = clampDiscount(discountPercent);
  if (discount <= 0) {
    return sale;
  }
  if (discount >= 99) {
    return Math.max(sale * 100, sale);
  }
  return Math.max(sale, Math.round(sale / (1 - discount / 100)));
}

function normalizePair(listPrice: number, salePrice: number): WbShelfPrice {
  let list = Math.max(1, Math.round(listPrice));
  let sale = Math.max(1, Math.round(salePrice));
  if (sale > list) {
    list = sale;
  }
  const discount = discountFromListAndSale(list, sale);
  // 用整数折扣回算折后价，保证与 WB 展示一致
  sale = saleFromListAndDiscount(list, discount);
  if (sale > list) {
    sale = list;
  }
  return { listPrice: list, salePrice: sale, discount };
}

export function crawledPriceBases(input: {
  price: number;
  originalPrice?: number | null;
  discountPrice?: number | null;
}): { original: number; discount: number; sale: number } {
  const sale = Math.max(0, Number(input.price) || 0);
  const discount = Math.max(0, Number(input.discountPrice) || sale);
  const original = Math.max(0, Number(input.originalPrice) || Math.max(discount, sale));
  return {
    original: original || discount || sale,
    discount: discount || sale || original,
    sale: sale || discount || original,
  };
}

export function pickCrawledPrice(
  source: PriceSource | undefined,
  bases: { original: number; discount: number; sale: number },
): number {
  if (source === 'original') {
    return bases.original || bases.discount || bases.sale;
  }
  if (source === 'discount') {
    return bases.discount || bases.sale || bases.original;
  }
  return bases.sale || bases.discount || bases.original;
}

function positiveFactor(value: number | null | undefined, fallback = 1): number {
  const factor = Number(value);
  return Number.isFinite(factor) && factor > 0 ? factor : fallback;
}

/**
 * 单品三字段联动：优先「原价 + 折扣%」，其次「原价 + 折后价」，再次「折后价 + 折扣%」。
 */
export function resolveManualShelfPrice(input: {
  listPrice?: number | null;
  salePrice?: number | null;
  discountPercent?: number | null;
  fallbackList: number;
  fallbackSale: number;
}): WbShelfPrice {
  const fallbackList = Math.max(1, Math.round(input.fallbackList || input.fallbackSale || 1));
  const fallbackSale = Math.max(1, Math.round(input.fallbackSale || fallbackList));
  const hasList = input.listPrice != null && Number.isFinite(Number(input.listPrice));
  const hasSale = input.salePrice != null && Number.isFinite(Number(input.salePrice));
  const hasDiscount = input.discountPercent != null && Number.isFinite(Number(input.discountPercent));

  if (hasList && hasDiscount) {
    const list = Math.max(1, Math.round(Number(input.listPrice)));
    const discount = clampDiscount(Number(input.discountPercent));
    return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
  }
  if (hasList && hasSale) {
    return normalizePair(Number(input.listPrice), Number(input.salePrice));
  }
  if (hasSale && hasDiscount) {
    const sale = Math.max(1, Math.round(Number(input.salePrice)));
    const discount = clampDiscount(Number(input.discountPercent));
    const list = listFromSaleAndDiscount(sale, discount);
    return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
  }
  if (hasList) {
    return normalizePair(Number(input.listPrice), Math.min(Number(input.listPrice), fallbackSale));
  }
  if (hasSale) {
    return normalizePair(Math.max(Number(input.salePrice), fallbackList), Number(input.salePrice));
  }
  if (hasDiscount) {
    const discount = clampDiscount(Number(input.discountPercent));
    return {
      listPrice: fallbackList,
      salePrice: saleFromListAndDiscount(fallbackList, discount),
      discount,
    };
  }
  return normalizePair(fallbackList, fallbackSale);
}

export function computeWbShelfPrice(input: {
  price: number;
  originalPrice?: number | null;
  discountPrice?: number | null;
  mode?: ShelfPriceMode;
  multiplier?: number;
  saleMultiplier?: number;
  listSource?: PriceSource | null;
  saleSource?: PriceSource | null;
  listPrice?: number | null;
  salePrice?: number | null;
  discountPercent?: number | null;
  fixedListPrice?: number | null;
  fixedSalePrice?: number | null;
  fixedDiscountPercent?: number | null;
  /** @deprecated 旧固定价，视为统一折后价且原价=折后价 */
  fixedPrice?: number | null;
}): WbShelfPrice {
  const bases = crawledPriceBases(input);
  const fallbackList = Math.max(1, Math.round(bases.original || bases.sale || 1));
  const fallbackSale = Math.max(1, Math.round(bases.sale || bases.discount || bases.original || 1));

  // 单品显式字段优先
  if (input.listPrice != null || input.salePrice != null || input.discountPercent != null) {
    return resolveManualShelfPrice({
      listPrice: input.listPrice,
      salePrice: input.salePrice,
      discountPercent: input.discountPercent,
      fallbackList,
      fallbackSale,
    });
  }

  const mode = input.mode || 'keep';
  const listFactor = positiveFactor(input.multiplier);
  const saleFactor = positiveFactor(input.saleMultiplier, listFactor);

  if (mode === 'from_sources' || mode === 'keep') {
    const listSource: PriceSource = mode === 'keep' ? 'original' : input.listSource || 'original';
    const saleSource: PriceSource = mode === 'keep' ? 'sale' : input.saleSource || 'sale';
    const list = Math.max(1, Math.round(pickCrawledPrice(listSource, bases) * (mode === 'keep' ? 1 : listFactor)));
    const sale = Math.max(1, Math.round(pickCrawledPrice(saleSource, bases) * (mode === 'keep' ? 1 : saleFactor)));
    return normalizePair(list, Math.min(list, sale));
  }

  if (mode === 'dual_times' || mode === 'original_times' || mode === 'sale_times') {
    const dualList = Math.max(1, Math.round(fallbackList * listFactor));
    const dualSale = Math.max(1, Math.round(fallbackSale * listFactor));
    return normalizePair(dualList, Math.min(dualList, dualSale));
  }

  if (mode === 'fixed_list_discount') {
    const list = Math.max(1, Math.round(Number(input.fixedListPrice) || fallbackList));
    const discount = clampDiscount(Number(input.fixedDiscountPercent) || 0);
    return { listPrice: list, salePrice: saleFromListAndDiscount(list, discount), discount };
  }

  if (mode === 'fixed_list_sale') {
    const list = Math.max(1, Math.round(Number(input.fixedListPrice) || fallbackList));
    const sale = Math.max(1, Math.round(Number(input.fixedSalePrice) || fallbackSale));
    return normalizePair(list, sale);
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

/** @deprecated 仅返回折后价，兼容旧测试/调用 */
export function computeShelfPrice(input: {
  price: number;
  originalPrice?: number | null;
  mode: ShelfPriceMode;
  multiplier?: number;
  fixedPrice?: number;
}): number {
  return computeWbShelfPrice(input).salePrice;
}

export function computeShelfStock(stock?: number | null, fallback = 0): number {
  if (stock == null || !Number.isFinite(Number(stock))) {
    return Math.max(0, Math.round(fallback));
  }
  return Math.max(0, Math.round(Number(stock)));
}
