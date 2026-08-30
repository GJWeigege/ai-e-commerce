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
  /** Ozon 优惠价（无卡划线后的展示价） */
  discountPrice?: number;
  imageUrls: string[];
  options: Record<string, string>;
};

/** Ozon 履约仓：FBO=Ozon 仓，FBS=卖家仓，MIXED=两边都有货 */
export type OzonFulfillment = 'FBO' | 'FBS' | 'MIXED';

/** 批量采集任务的仓库筛选；ALL 表示不限制 */
export type OzonWarehouseFilter = 'FBO' | 'FBS' | 'ALL';

export type StandardProduct = {
  skuId: string;
  name: string;
  sourceUrl: string;
  mainImageUrl?: string;
  imageUrls: string[];
  videoUrls?: string[];
  /** 实际销售价（优先 Ozon 卡价） */
  price: number;
  /** 划线原价 */
  originalPrice?: number;
  /** 优惠价（活动价，不含 Ozon 卡） */
  discountPrice?: number;
  currency: string;
  stock: number;
  /** 页面解析到的 FBO 库存；未知则为 undefined */
  fboStock?: number;
  /** 页面解析到的 FBS 库存；未知则为 undefined */
  fbsStock?: number;
  warehouseType?: OzonFulfillment;
  specs: ProductSpec[];
  variants?: ProductVariant[];
  skuOptions?: ProductSkuOption[];
  categoryPath?: string;
  brand?: string;
  rating?: number;
  reviewCount?: number;
  salesCount: number;
  description?: string;
};

export function normalizeVariantDimName(name: string): string {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
    .trim();
}

export function inferWeightOption(name: string, sourceUrl = ''): string | undefined {
  let decodedUrl = sourceUrl || '';
  try {
    decodedUrl = decodeURIComponent(decodedUrl);
  } catch {
    /* keep raw slug when percent-encoding is malformed */
  }
  const blob = `${name} ${decodedUrl}`;
  if (/\b1(?:[.,]0)?\s*кг|\b1-kg\b|\b1000[\s-]*g\b/i.test(blob)) {
    return '1000';
  }
  const grams = blob.match(/(\d{2,4})\s*г(?![а-яё])/i) || blob.match(/(\d{2,4})-g\b/i);
  return grams?.[1];
}

/** 同一 SPU：去掉克重和口味词，便于把 250g / 1kg 收成一条商品 */
export function productFamilyKey(name: string, brand?: string | null, variants: ProductVariant[] = []): string {
  let base = String(name || '');
  base = base.replace(/,?\s*\d+[\s.,]*\d*\s*(кг|г|g|kg|мл|л)(?![а-яёa-z])/gi, ' ');
  base = base.replace(/\s*,\s*/g, ' ');
  let strippedFlavor = false;
  for (const dim of variants) {
    if (!/вкус|название вкуса|цвет|аромат/i.test(dim.name)) {
      continue;
    }
    for (const value of dim.values) {
      if (!value.value) {
        continue;
      }
      const safe = value.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = base.replace(new RegExp(safe, 'gi'), ' ');
      if (next !== base) {
        strippedFlavor = true;
        base = next;
      }
    }
  }
  base = base.replace(/\s+/g, ' ').trim();
  const parts = base.split(' ').filter(Boolean);
  if (!strippedFlavor && parts.length >= 3) {
    base = parts.slice(0, -1).join(' ');
  }
  const stem = base.toLowerCase();
  const brandNorm = String(brand || '').trim().toLowerCase();
  if (brandNorm && !stem.includes(brandNorm)) {
    return `${brandNorm} ${stem}`.trim();
  }
  return stem;
}

export function keepMainSkuOnly(product: StandardProduct): StandardProduct {
  const variants = dedupeVariants(product.variants ?? []).map((dim) => ({
    ...dim,
    values: (dim.values || []).map((value) => ({
      ...value,
      skuId: value.skuId && value.skuId === product.skuId ? value.skuId : undefined,
      sourceUrl: value.skuId && value.skuId !== product.skuId ? undefined : value.sourceUrl,
    })),
  }));
  return {
    ...product,
    variants,
    skuOptions: [
      {
        skuId: product.skuId,
        name: product.name,
        sourceUrl: String(product.sourceUrl || '').split('?')[0],
        price: Number(product.price) || 0,
        originalPrice: product.originalPrice,
        discountPrice: product.discountPrice,
        imageUrls: product.imageUrls ?? [],
        options: optionsForSku({
          skuId: product.skuId,
          name: product.name,
          sourceUrl: product.sourceUrl,
          variants,
        }),
      },
    ],
  };
}

export function familySkuIds(product: { skuId?: string; skuOptions?: Array<{ skuId?: string }> | null }): string[] {
  return [
    ...new Set(
      [product.skuId, ...(product.skuOptions ?? []).map((item) => item.skuId)]
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ];
}

export function skuOptionLabel(item: {
  skuId?: string;
  name?: string;
  options?: Record<string, string> | null;
}): string {
  const text = Object.entries(item.options || {})
    .filter(([, value]) => String(value || '').trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join(' / ');
  return text || String(item.name || '').trim() || String(item.skuId || '').trim();
}

export function isRejectedAspectName(name: string): boolean {
  return /покупают вместе|похожие|рекоменд|смотрели|хиты продаж|вам понрав|другие товар|популярн|карусел/i.test(
    String(name || ''),
  );
}

/** PDP 规格选择器：重量、口味、颜色、尺码、数量等；排除推荐位标题 */
export function isSpecAspectName(name: string): boolean {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n || isRejectedAspectName(n)) {
    return false;
  }
  return /вес|вкус|цвет|размер|объ[её]м|фасовка|количест|рост|обхват|длин|ширин|высот|модель|комплект|штук|название|аромат|плотность|состав|покрой|рукав|вырез|застежк|color|size|qty|variant/i.test(
    n,
  );
}

/** 去掉克重和末尾口味词后的 URL slug，用来排除推荐位里的其他商品 */
export function ozonListingSlugFamily(urlOrSlug: string): string {
  const path = String(urlOrSlug || '').split('?')[0].toLowerCase();
  const slug =
    path.match(/\/product\/([a-z0-9\-._%]+)-\d{6,}/i)?.[1] ||
    path.replace(/^.*\//, '').replace(/-\d{6,}$/, '');
  const parts = slug
    .replace(/-\d{2,5}-g(?:r)?$/i, '')
    .replace(/-1-kg$/i, '')
    .replace(/-\d+-kg$/i, '')
    .replace(/-\d+-shtuk[ia]?$/i, '')
    .replace(/-\d+-sht$/i, '')
    .replace(/-\d+-pieces?$/i, '')
    .split('-')
    .filter(Boolean);
  if (parts.length >= 3) {
    parts.pop();
  }
  return parts.join('-');
}

export function isSameOzonListing(
  a: { name?: string; sourceUrl?: string; brand?: string | null; variants?: ProductVariant[] | null },
  b: { name?: string; sourceUrl?: string; brand?: string | null; variants?: ProductVariant[] | null },
): boolean {
  const slugA = ozonListingSlugFamily(a.sourceUrl || '');
  const slugB = ozonListingSlugFamily(b.sourceUrl || '');
  if (slugA && slugB) {
    return slugA === slugB;
  }
  const keyA = productFamilyKey(a.name || '', a.brand, a.variants ?? []);
  const keyB = productFamilyKey(b.name || '', b.brand, b.variants ?? []);
  return Boolean(keyA.length >= 10 && keyA === keyB);
}

export function isSameOzonFamily(
  a: {
    skuId?: string;
    name?: string;
    sourceUrl?: string;
    brand?: string | null;
    variants?: ProductVariant[] | null;
    skuOptions?: Array<{ skuId?: string }> | null;
  },
  b: {
    skuId?: string;
    name?: string;
    sourceUrl?: string;
    brand?: string | null;
    variants?: ProductVariant[] | null;
    skuOptions?: Array<{ skuId?: string }> | null;
  },
): boolean {
  const idsA = new Set(familySkuIds(a));
  if (familySkuIds(b).some((id) => idsA.has(id))) {
    return true;
  }
  return isSameOzonListing(a, b);
}

/** 按 SKU 自身的芯片/标题绑定规格，禁止回退到第一个口味 */
export function optionsForSku(input: {
  skuId: string;
  name: string;
  sourceUrl?: string;
  variants?: ProductVariant[];
}): Record<string, string> {
  const options: Record<string, string> = {};
  for (const dim of input.variants ?? []) {
    const dimName = normalizeVariantDimName(dim.name);
    if (!dimName) {
      continue;
    }
    const match =
      dim.values.find((item) => item.skuId && item.skuId === input.skuId) ||
      dim.values.find((item) => (item.sourceUrl || '').includes(input.skuId)) ||
      dim.values.find((item) => item.value && input.name.includes(item.value));
    if (match?.value) {
      options[dimName] = match.value;
    }
  }
  if (!Object.keys(options).some((key) => /вес/i.test(key))) {
    const weight = inferWeightOption(input.name, input.sourceUrl);
    if (weight) {
      options['Вес товара, г'] = weight;
    }
  }
  return options;
}

export function dedupeVariants(variants: ProductVariant[]): ProductVariant[] {
  const map = new Map<string, ProductVariant>();
  for (const dim of variants) {
    const name = normalizeVariantDimName(dim.name);
    if (!name) {
      continue;
    }
    const current = map.get(name) ?? { name, values: [] };
    const seen = new Set(current.values.map((item) => item.value));
    for (const value of dim.values || []) {
      if (seen.has(value.value)) {
        const existing = current.values.find((item) => item.value === value.value);
        if (existing) {
          existing.skuId = existing.skuId || value.skuId;
          existing.sourceUrl = existing.sourceUrl || value.sourceUrl;
          existing.selected = existing.selected || value.selected;
          existing.price = existing.price || value.price;
          existing.imageUrls = existing.imageUrls?.length ? existing.imageUrls : value.imageUrls;
        }
        continue;
      }
      seen.add(value.value);
      current.values.push({ ...value });
    }
    map.set(name, current);
  }
  return [...map.values()];
}

export function alignSkuOptions(skuOptions: ProductSkuOption[], variants: ProductVariant[]): ProductSkuOption[] {
  const dims = dedupeVariants(variants);
  return skuOptions.map((item) => ({
    ...item,
    options: optionsForSku({
      skuId: item.skuId,
      name: item.name,
      sourceUrl: item.sourceUrl,
      variants: dims,
    }),
  }));
}

/** 规格芯片上已有 skuId 时，补进可下单列表，避免预览只能点当前 SKU */
export function fillSkuOptionsFromVariants(product: {
  skuId: string;
  name: string;
  sourceUrl?: string;
  price?: number;
  originalPrice?: number;
  discountPrice?: number;
  imageUrls?: string[];
  variants?: ProductVariant[] | null;
  skuOptions?: ProductSkuOption[] | null;
}): ProductSkuOption[] {
  const variants = dedupeVariants(product.variants ?? []);
  const map = new Map<string, ProductSkuOption>();
  for (const item of product.skuOptions ?? []) {
    if (item?.skuId) {
      map.set(item.skuId, item);
    }
  }
  if (product.skuId && !map.has(product.skuId)) {
    map.set(product.skuId, skuOptionStub(product));
  }
  for (const dim of variants) {
    for (const value of dim.values) {
      const skuId = value.skuId;
      if (!skuId || map.has(skuId)) {
        continue;
      }
      map.set(skuId, {
        skuId,
        name: `${product.name} / ${value.value}`,
        sourceUrl: String(value.sourceUrl || product.sourceUrl || '').split('?')[0],
        price: Number(value.price || product.price || 0),
        originalPrice: product.originalPrice,
        discountPrice: product.discountPrice,
        imageUrls: value.imageUrls ?? [],
        options: { [dim.name]: value.value },
      });
    }
  }
  return alignSkuOptions([...map.values()], variants);
}

function skuOptionStub(item: {
  skuId: string;
  name: string;
  sourceUrl?: string;
  price?: number;
  originalPrice?: number | null;
  discountPrice?: number | null;
  imageUrls?: string[];
  variants?: ProductVariant[] | null;
}): ProductSkuOption {
  return {
    skuId: item.skuId,
    name: item.name,
    sourceUrl: String(item.sourceUrl || '').split('?')[0],
    price: Number(item.price || 0),
    originalPrice: item.originalPrice != null ? Number(item.originalPrice) : undefined,
    discountPrice: item.discountPrice != null ? Number(item.discountPrice) : undefined,
    imageUrls: item.imageUrls ?? [],
    options: optionsForSku({
      skuId: item.skuId,
      name: item.name,
      sourceUrl: item.sourceUrl,
      variants: item.variants ?? [],
    }),
  };
}

/** 用各 SKU 标题补齐重量维度，避免只采到口味、看不到 250/1000 */
export function ensureWeightVariant(variants: ProductVariant[], skuOptions: ProductSkuOption[]): ProductVariant[] {
  const dims = dedupeVariants(variants);
  const weights = new Map<string, { skuId?: string; sourceUrl?: string }>();
  for (const opt of skuOptions) {
    const weight =
      optionsForSku({
        skuId: opt.skuId,
        name: opt.name,
        sourceUrl: opt.sourceUrl,
        variants: dims,
      })['Вес товара, г'] || inferWeightOption(opt.name, opt.sourceUrl);
    if (!weight || weights.has(weight)) {
      continue;
    }
    weights.set(weight, { skuId: opt.skuId, sourceUrl: opt.sourceUrl });
  }
  if (weights.size < 2) {
    return dims.filter((item) => item.values.length >= 2);
  }
  return dedupeVariants([
    ...dims.filter((item) => !/вес/i.test(item.name)),
    {
      name: 'Вес товара, г',
      values: [...weights.entries()].map(([value, meta]) => ({
        value,
        skuId: meta.skuId,
        sourceUrl: meta.sourceUrl,
      })),
    },
  ]).filter((item) => item.values.length >= 2);
}

export function combineFamilyListings(
  parts: Array<{
    skuId: string;
    name: string;
    sourceUrl?: string;
    price?: number | string | { toString(): string };
    originalPrice?: number | string | { toString(): string } | null;
    discountPrice?: number | string | { toString(): string } | null;
    imageUrls?: string[];
    variants?: ProductVariant[] | null;
    skuOptions?: ProductSkuOption[] | null;
  }>,
): { variants: ProductVariant[]; skuOptions: ProductSkuOption[] } {
  const variants = dedupeVariants(parts.flatMap((item) => item.variants ?? []));
  const bySku = new Map<string, ProductSkuOption>();
  for (const part of parts) {
    const stub = skuOptionStub({
      skuId: part.skuId,
      name: part.name,
      sourceUrl: part.sourceUrl,
      price: Number(part.price || 0),
      originalPrice: part.originalPrice == null ? undefined : Number(part.originalPrice),
      discountPrice: part.discountPrice == null ? undefined : Number(part.discountPrice),
      imageUrls: part.imageUrls,
      variants: part.variants,
    });
    const extras = (part.skuOptions ?? []).filter((item) => item?.skuId);
    for (const item of [stub, ...extras]) {
      const prev = bySku.get(item.skuId);
      if (!prev || (item.imageUrls?.length || 0) > (prev.imageUrls?.length || 0)) {
        bySku.set(item.skuId, { ...prev, ...item, imageUrls: item.imageUrls?.length ? item.imageUrls : prev?.imageUrls || [] });
      }
    }
  }
  const skuOptions = alignSkuOptions([...bySku.values()], variants);
  const withWeight = ensureWeightVariant(variants, skuOptions);
  const seed = parts[0];
  return {
    variants: withWeight,
    skuOptions: fillSkuOptionsFromVariants({
      skuId: seed.skuId,
      name: seed.name,
      sourceUrl: seed.sourceUrl,
      price: Number(seed.price || 0),
      imageUrls: seed.imageUrls,
      variants: withWeight,
      skuOptions,
    }),
  };
}
