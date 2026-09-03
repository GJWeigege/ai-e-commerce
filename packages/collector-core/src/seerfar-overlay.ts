import type { OzonFulfillment, ProductSpec, StandardProduct } from '@aiecom/shared';

/** Seerfar 注入到 Ozon PDP 的 .quick-view 面板解析结果 */
export type SeerfarOverlay = {
  skuId?: string;
  brand?: string;
  sellerName?: string;
  warehouseType?: OzonFulfillment;
  deliveryText?: string;
  weightGrams?: number;
  dimension?: string;
  depth?: number;
  width?: number;
  height?: number;
  stock?: number;
  salesCount?: number;
};

type OverlayField =
  | 'sku'
  | 'weight'
  | 'volume'
  | 'stock'
  | 'warehouse'
  | 'deliveryTime'
  | 'brand'
  | 'seller'
  | 'sales';

function compactLabel(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function classifyLabel(raw: string): OverlayField | '' {
  const n = compactLabel(raw);
  if (!n) return '';
  if (/销售额|выручк|revenue/.test(n)) return '';
  if (/配送时效|交货|срокдоставки|deliverytime|leadtime/.test(n)) return 'deliveryTime';
  if (/近30天销量|^销量$|^sales$|^orders$/.test(n) && !/额|金额|руб/.test(n)) return 'sales';
  if (/^sku$|^артикул$|^货号$/.test(n)) return 'sku';
  if (/重量|^weight$|^вес$|^вестовара|^весбрутто|^весвупаков/.test(n)) return 'weight';
  if (/体积|^volume$|^dimension|^габарит|尺寸|包装尺寸/.test(n)) return 'volume';
  if (/^库存$|^stock$|^остаток|^наличие|^qty$/.test(n)) return 'stock';
  if (/^配送$|^履约|^fulfillment|^warehouse$|^склад$|^仓库$|^发货仓$/.test(n)) return 'warehouse';
  if (/^品牌$|^brand$|^бренд$|^торговаямарка$/.test(n)) return 'brand';
  if (/^卖家$|^seller$|^продавец$/.test(n)) return 'seller';
  return '';
}

function parseDimensionMm(raw: string): { depth: number; width: number; height: number; dimension: string } | null {
  const source = String(raw || '');
  const text = source.replace(/,/g, '.').replace(/\s+/g, '').trim();
  const match = text.match(
    /^(\d+(?:\.\d+)?)\s*[xх×*]\s*(\d+(?:\.\d+)?)(?:\s*[xх×*]\s*(\d+(?:\.\d+)?))?(?:мм|mm|см|cm)?$/i,
  );
  if (!match) return null;
  const rawDepth = Number(match[1]);
  const rawWidth = Number(match[2]);
  const rawHeight = Number(match[3] || 0);
  if (![rawDepth, rawWidth, rawHeight].every((item) => Number.isFinite(item) && item > 0)) return null;
  const hasCm = /см|cm/i.test(source) && !/мм|mm/i.test(source);
  const toMm = (value: number) => (hasCm ? value * 10 : value);
  const depth = toMm(rawDepth);
  const width = toMm(rawWidth);
  const height = toMm(rawHeight);
  if (![depth, width, height].every((item) => item > 0 && item < 5000)) return null;
  return { depth, width, height, dimension: `${Math.round(depth)}x${Math.round(width)}x${Math.round(height)}` };
}

function parseWeightGrams(raw: string): number {
  const match = String(raw || '')
    .replace(',', '.')
    .match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|g)?/i);
  if (!match) return 0;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (match[2] && /кг|kg/i.test(match[2])) {
    const grams = Math.round(num * 1000);
    return grams > 0 && grams < 100000 ? grams : 0;
  }
  if (num > 0 && num < 80 && num % 1 !== 0) return Math.round(num * 1000);
  if (num >= 100000) return 0;
  return Math.round(num);
}

function parseStock(raw: string): number {
  const match = String(raw || '').replace(/\s+/g, '').match(/(\d{1,7})/);
  if (!match) return 0;
  const stock = Number(match[1]);
  return Number.isFinite(stock) && stock > 0 && stock < 1e7 ? stock : 0;
}

function parseWarehouse(raw: string): OzonFulfillment | undefined {
  const text = String(raw || '')
    .toUpperCase()
    .replace(/Ё/g, 'Е');
  const fbo = /\bFBO\b/.test(text) || /СКЛАД\s+OZON|СО СКЛАДА OZON/.test(text);
  const fbs = /\bFBS\b/.test(text) || /СКЛАД\s+ПРОДАВЦ|СО СКЛАДА ПРОДАВЦ/.test(text);
  if (fbo && fbs) return 'MIXED';
  if (fbo) return 'FBO';
  if (fbs) return 'FBS';
  return undefined;
}

function firstLine(raw: string): string {
  return String(raw || '')
    .split(/[\n•|]/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function collectPairs(text: string): Array<{ name: string; value: string }> {
  const source = String(text || '').replace(/\r/g, '\n');
  const found: Array<{ name: string; start: number; valueStart: number }> = [];
  const re = /(?:^|[\n;；])\s*([^\n:：]{1,40}?)\s*[:：][^\S\n]*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    found.push({ name: String(match[1] || '').replace(/\s+/g, ' ').trim(), start: match.index, valueStart: match.index + match[0].length });
  }
  return found
    .map((item, i) => ({
      name: item.name,
      value: source
        .slice(item.valueStart, found[i + 1] ? found[i + 1].start : source.length)
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((item) => item.name && item.value && item.name.length <= 80 && item.value.length <= 200);
}

export const SEERFAR_OVERLAY_SELECTORS = [
  '.quick-view',
  '[class*="quick-view"]',
  '[class*="seerfar"]',
  '[id*="seerfar"]',
].join(', ');

export function parseSeerfarOverlayText(raw: string): SeerfarOverlay | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (!/重量|体积|库存|品牌|配送|weight|volume|stock|brand|вес|габарит|\bfbo\b|\bfbs\b/i.test(text)) {
    return null;
  }
  const overlay: SeerfarOverlay = {};
  for (const pair of collectPairs(text)) {
    const field = classifyLabel(pair.name);
    if (!field) continue;
    if (field === 'sku') {
      const sku = String(pair.value).match(/(\d{6,})/);
      if (sku) overlay.skuId = sku[1];
    } else if (field === 'weight') {
      const weight = parseWeightGrams(pair.value);
      if (weight > 0) overlay.weightGrams = weight;
    } else if (field === 'volume') {
      const parsed = parseDimensionMm(pair.value);
      if (parsed) {
        overlay.dimension = parsed.dimension;
        overlay.depth = parsed.depth;
        overlay.width = parsed.width;
        overlay.height = parsed.height;
      }
    } else if (field === 'stock') {
      const stock = parseStock(pair.value);
      if (stock > 0) overlay.stock = stock;
    } else if (field === 'warehouse') {
      const warehouse = parseWarehouse(pair.value);
      if (warehouse) overlay.warehouseType = warehouse;
    } else if (field === 'deliveryTime') {
      const delivery = firstLine(pair.value);
      if (delivery && delivery.length < 80) overlay.deliveryText = delivery;
    } else if (field === 'brand') {
      const brand = firstLine(pair.value);
      if (brand && brand.length < 80 && !/^ozon$/i.test(brand)) overlay.brand = brand;
    } else if (field === 'seller') {
      const seller = firstLine(pair.value).replace(/本土|本地|海外/g, '').trim();
      if (seller && seller.length < 80) overlay.sellerName = seller;
    } else if (field === 'sales') {
      const sales = parseStock(pair.value);
      if (sales > 0) overlay.salesCount = sales;
    }
  }
  if (
    !overlay.weightGrams &&
    !overlay.depth &&
    overlay.stock == null &&
    !overlay.brand &&
    !overlay.warehouseType
  ) {
    return null;
  }
  return overlay;
}

/** 转成服务端 / harvest 已认的物流口径规格名 */
export function seerfarOverlayToSpecs(overlay: SeerfarOverlay): ProductSpec[] {
  const specs: ProductSpec[] = [];
  if (overlay.depth && overlay.width && overlay.height) {
    specs.push(
      { name: 'Длина упаковки, мм', value: String(Math.round(overlay.depth)) },
      { name: 'Ширина упаковки, мм', value: String(Math.round(overlay.width)) },
      { name: 'Высота упаковки, мм', value: String(Math.round(overlay.height)) },
    );
  }
  if (overlay.dimension) {
    specs.push({ name: 'dimension', value: overlay.dimension });
  }
  if (overlay.weightGrams) {
    specs.push({ name: 'Вес брутто, г', value: String(overlay.weightGrams) });
  }
  if (overlay.brand) specs.push({ name: 'Бренд', value: overlay.brand });
  if (overlay.sellerName) specs.push({ name: 'Продавец', value: overlay.sellerName });
  if (overlay.warehouseType) specs.push({ name: 'Склад отгрузки', value: overlay.warehouseType });
  if (overlay.deliveryText) specs.push({ name: 'Срок доставки', value: overlay.deliveryText });
  return specs;
}

export function overlayMatchesSku(overlay: SeerfarOverlay | null, pageSku: string): boolean {
  if (!overlay) return false;
  const wanted = String(pageSku || '').match(/(\d{6,})/);
  if (!wanted || !overlay.skuId) return true;
  return overlay.skuId === wanted[1];
}

/**
 * 用 seerfar 面板补全商品。体积/重量/库存以面板为准（Ozon 公开页经常缺这三项）；
 * 品牌只补缺。pageSku 对不上时丢弃，避免点了推荐卡还吃上一件的面板。
 */
export function applySeerfarOverlayToProduct(
  product: StandardProduct & { kind?: string },
  overlay: SeerfarOverlay | null,
  pageSku = '',
): StandardProduct {
  if (!product || product.kind === 'listing' || !overlay || !overlayMatchesSku(overlay, pageSku || product.skuId)) {
    return product;
  }
  const next = overlay as SeerfarOverlay;
  const specs = Array.isArray(product.specs) ? product.specs.slice() : [];
  const seen = new Set(specs.map((item) => String(item.name || '')));
  seerfarOverlayToSpecs(next).forEach((spec) => {
    const idx = specs.findIndex((item) => item.name === spec.name);
    if (idx >= 0) specs[idx] = spec;
    else if (!seen.has(spec.name)) specs.unshift(spec);
  });
  product.specs = specs;
  if (next.brand && !product.brand) product.brand = next.brand;
  if (next.stock && next.stock > 0) {
    const pageStock = Number(product.stock) || 0;
    if (pageStock <= 1 || next.stock > pageStock) product.stock = next.stock;
  }
  if (next.warehouseType && !product.warehouseType) product.warehouseType = next.warehouseType;
  if (next.salesCount && !(Number(product.salesCount) > 0)) product.salesCount = next.salesCount;
  return product;
}
