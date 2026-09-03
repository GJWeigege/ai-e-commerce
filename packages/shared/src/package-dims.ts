export type PackageDimensionSource = {
  name?: string | null;
  description?: string | null;
  skuOptions?: Array<{ name?: string; options?: Record<string, string> }>;
};

export type PackageDimensions = {
  length?: number;
  width?: number;
  height?: number;
  weightBrutto?: number;
};

export type PackageDimensionGaps = {
  dimensions: PackageDimensions;
  missingSize: boolean;
  missingWeight: boolean;
};

const DIM_KEYS = {
  length: ['длина', 'length', '长', 'глубина', 'depth', 'длина упаковки', 'диаметр дна', 'диаметр', 'diameter'],
  width: ['ширина', 'width', '宽', 'ширина упаковки', 'диаметр дна', 'диаметр', 'diameter'],
  height: ['высота стенки', 'высота', 'height', '高', 'толщина', 'thickness', 'высота упаковки'],
  weight: ['вес', 'weight', '重量', 'вес брутто', 'вес товара', 'вес с упаковкой'],
};

const APPAREL_SIZE_KEYS = ['размер', 'size', '尺码', 'рос размер', 'рост', 'eu size', 'ru size', 'размер производителя'];

const COMBINED_SIZE_RE =
  /(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[xх×*]\s*(\d+(?:[.,]\d+)?))?\s*(мм|mm|см|cm)?/gi;

/** 净重转毛重：至少加 100g，或净重的 20%，取更大，避免仓内实测超标罚款 */
const PACK_MIN_KG = 0.1;
const PACK_RATIO = 0.2;
/** 商品口径边长转发货口径：每边加 2cm，覆盖纸箱板厚与缠膜。已是包裹口径的边不再叠加 */
const PACK_EDGE_CM = 2;
/** WB 包裹边长上限（cm）。烟花「升空 20 м」曾被乘 100 再加包装余量变成 2002 */
export const WB_MAX_PACKAGE_EDGE_CM = 700;

function hasInchUnit(text: string): boolean {
  return /дюйм|inch/i.test(text);
}

/** 只认独立的 м / метр / meter，避免 диаметр、размер、дюйм 里的「м」被当成米 */
function hasMeterUnit(text: string): boolean {
  const src = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (hasInchUnit(src) || /см|cm/i.test(src)) {
    return false;
  }
  return /(?:^|[^a-zа-яё])(?:метр(?:а|ов)?|meters?|metres?|м(?![мa-zа-яё]))(?![a-zа-яё])/i.test(src);
}

function clampPackageEdgeCm(cm: number): number | null {
  if (!Number.isFinite(cm) || cm <= 0 || cm > WB_MAX_PACKAGE_EDGE_CM) {
    return null;
  }
  return cm;
}

/** 烟花升空高度、口径英寸等不是包裹边长 */
export function isNonPackageDimensionSpec(name: string, value = ''): boolean {
  const blob = `${normalizeKey(name)} ${String(value || '').toLowerCase()}`;
  if (/подъем|эффект|полет|разрыв|взрыв|калибр|caliber|дюйм|inch|дальност/.test(blob)) {
    return true;
  }
  return /до\s+\d+(?:[.,]\d+)?\s*(?:м(?!м)|метр)/i.test(String(value || ''));
}

export function parseDimensionNumber(
  raw: string,
  kind: 'length' | 'width' | 'height' | 'weight',
  context = '',
): number | null {
  const value = String(raw || '').replace(',', '.').trim();
  const num = Number(value.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  const text = `${context} ${value}`.toLowerCase();
  if (kind === 'weight') {
    if (/кг|kg/i.test(text)) {
      return Math.max(0.01, num);
    }
    if (/г(?!р)|g\b|gram/i.test(text)) {
      return Math.max(0.01, num / 1000);
    }
    return num;
  }
  if (isNonPackageDimensionSpec(context, value)) {
    return null;
  }
  if (/мм|mm/i.test(text)) {
    return clampPackageEdgeCm(Math.max(0.1, num / 10));
  }
  if (hasMeterUnit(text)) {
    return clampPackageEdgeCm(Math.max(1, num * 100));
  }
  return clampPackageEdgeCm(num);
}

function looksLikeCombinedSize(value: string): boolean {
  return /[xх×*]/.test(value) && (value.match(/\d+/g) || []).length >= 2;
}

function parseCombinedSize(text: string): { length: number; width: number; height: number } | null {
  COMBINED_SIZE_RE.lastIndex = 0;
  let best: { length: number; width: number; height: number; volume: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = COMBINED_SIZE_RE.exec(String(text || ''))) !== null) {
    const unit = (match[4] || '').toLowerCase();
    if (!match[3] && !unit) {
      continue;
    }
    const toCm = (raw: string) => {
      const num = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(num) || num <= 0) {
        return 0;
      }
      return unit === 'мм' || unit === 'mm' ? num / 10 : num;
    };
    const edges = [toCm(match[1]), toCm(match[2]), match[3] ? toCm(match[3]) : 0]
      .filter((item) => item > 0 && item <= WB_MAX_PACKAGE_EDGE_CM)
      .sort((a, b) => b - a);
    if (!edges.length) {
      continue;
    }
    const length = edges[0];
    const width = edges[1] || 0;
    const height = edges[2] || 0;
    const volume = length * (width || 1) * (height || 1);
    if (!best || volume > best.volume) {
      best = { length, width, height, volume };
    }
  }
  return best ? { length: best.length, width: best.width, height: best.height } : null;
}

function parseWeightFromText(text: string): number | null {
  const cleaned = String(text || '').replace(/\/\s*100\s*(?:г|гр|g)\b/gi, ' ');
  let best = 0;
  for (const match of cleaned.matchAll(/(\d+(?:[.,]\d+)?)\s*(кг|kg)\b/gi)) {
    const num = Number(match[1].replace(',', '.'));
    if (Number.isFinite(num) && num > 0) {
      best = Math.max(best, num);
    }
  }
  for (const match of cleaned.matchAll(/(\d+(?:[.,]\d+)?)\s*(г(?![а-яё])|g\b|грамм)/gi)) {
    const num = Number(match[1].replace(',', '.'));
    if (Number.isFinite(num) && num > 0) {
      best = Math.max(best, num / 1000);
    }
  }
  return best > 0 ? best : null;
}

function parseLongestEdgeFromText(text: string): number {
  let best = 0;
  for (const match of String(text || '').matchAll(/(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm)(?![a-zа-яё])/gi)) {
    const num = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      continue;
    }
    const unit = match[2].toLowerCase();
    const cm = unit === 'мм' || unit === 'mm' ? num / 10 : num;
    if (cm >= 1 && cm <= 500) {
      best = Math.max(best, cm);
    }
  }
  return best;
}

function normalizeKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_:/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePhysicalPackageSize(value: string): boolean {
  const text = String(value || '');
  return /[xх×*]/.test(text) && /(см|mm|мм|cm)(?![a-zа-яё])/i.test(text) && (text.match(/\d+/g) || []).length >= 2;
}

function isApparelSizeName(name: string, value = ''): boolean {
  if (looksLikePhysicalPackageSize(value)) {
    return false;
  }
  const keyNorm = normalizeKey(name).replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (APPAREL_SIZE_KEYS.some((alias) => keyNorm.includes(alias.replace(/\./g, ' ')))) {
    return true;
  }
  return keyNorm === 'рост' || keyNorm === 'eu' || keyNorm === 'ru';
}

/** 名称里带 упаковк/брутто/gross = 已经是发货包裹口径，不能再叠加包装余量 */
function isPackageScopedName(name: string): boolean {
  return /упаков|брутто|brutto|gross|посылк/i.test(normalizeKey(name));
}

function isGrossWeightName(name: string): boolean {
  return isPackageScopedName(name);
}

function isProductWeightName(name: string): boolean {
  const key = normalizeKey(name);
  return /товар|нетто|net\b/.test(key) && !isGrossWeightName(name);
}

function ceilKg(value: number): number {
  return Math.max(0.01, Math.ceil(value * 1000) / 1000);
}

function packingAllowanceKg(netKg: number): number {
  return Math.max(PACK_MIN_KG, netKg * PACK_RATIO);
}

function toGrossKg(netKg: number): number {
  return ceilKg(netKg + packingAllowanceKg(netKg));
}

export function hasPackageDimensionValue(dims: PackageDimensions): boolean {
  return Boolean(dims.length || dims.width || dims.height || dims.weightBrutto);
}

export function packageDimensionGaps(dims: PackageDimensions): { missingSize: boolean; missingWeight: boolean } {
  return {
    missingSize: !(dims.length && dims.width && dims.height),
    missingWeight: !(dims.weightBrutto && dims.weightBrutto > 0),
  };
}

/** 只返回采集到的边长/重量，缺项不填默认值 */
export function mapPackageDimensions(
  specs: Array<{ name: string; value: string }>,
  source?: PackageDimensionSource,
): PackageDimensions {
  const rows: Array<{ name: string; value: string }> = [
    ...specs,
    ...(source?.skuOptions || []).flatMap((item) =>
      Object.entries(item.options || {}).map(([name, value]) => ({ name, value: String(value) })),
    ),
  ];
  const found = { length: 0, width: 0, height: 0, weightBrutto: 0 };
  let productWeight = 0;
  let hasExplicitBrutto = false;
  let hasExplicitPackageSize = false;

  for (const spec of rows) {
    const key = normalizeKey(spec.name);
    // 锅盖直径 / 涂层厚度不是商品外廓，不能当成长宽高
    if (/крышк|покрыт/.test(key) && /диаметр|diameter|размер/.test(key)) {
      continue;
    }
    if (isNonPackageDimensionSpec(spec.name, spec.value)) {
      continue;
    }
    if (looksLikeCombinedSize(spec.value) && !DIM_KEYS.weight.some((alias) => key.includes(alias))) {
      continue;
    }
    (Object.keys(DIM_KEYS) as Array<keyof typeof DIM_KEYS>).forEach((dim) => {
      if (!DIM_KEYS[dim].some((alias) => key.includes(alias))) {
        return;
      }
      const parsed = parseDimensionNumber(spec.value, dim === 'weight' ? 'weight' : dim, spec.name);
      if (!parsed) {
        return;
      }
      if (dim === 'weight') {
        found.weightBrutto = Math.max(found.weightBrutto, parsed);
        if (isGrossWeightName(spec.name)) {
          hasExplicitBrutto = true;
        }
        if (isProductWeightName(spec.name)) {
          productWeight = Math.max(productWeight, parsed);
        }
      } else {
        found[dim] = Math.max(found[dim], parsed);
        if (isPackageScopedName(spec.name)) {
          hasExplicitPackageSize = true;
        }
      }
    });
  }

  const hasNamedSize = Boolean(found.length && found.width && found.height);
  if (!hasNamedSize) {
    for (const spec of rows) {
      if (isApparelSizeName(spec.name, spec.value) || isNonPackageDimensionSpec(spec.name, spec.value)) {
        continue;
      }
      const looksLikeTrackingTriple =
        /^(dimension|volume|габарит|体积)/i.test(normalizeKey(spec.name)) &&
        !/(см|mm|мм|cm)/i.test(spec.value) &&
        (String(spec.value).match(/\d+/g) || []).length >= 3;
      const combined = parseCombinedSize(
        looksLikeTrackingTriple ? `${spec.name} ${spec.value} mm` : `${spec.name} ${spec.value}`,
      );
      if (!combined) {
        continue;
      }
      found.length = Math.max(found.length, combined.length);
      found.width = Math.max(found.width, combined.width);
      found.height = Math.max(found.height, combined.height);
    }
  }

  const blob = [source?.name, source?.description, ...(source?.skuOptions || []).map((item) => item.name || '')]
    .filter(Boolean)
    .join(' ');
  const hasCompleteSize = Boolean(found.length && found.width && found.height);
  const looksLikeVariantSizes = /\d+(?:[.,]\d+)?\s*[xх×*]\s*\d+(?:[.,]\d+)?\s*(?:мм|mm|см|cm)?\s*\/\s*\d+/i.test(blob);
  if (!hasCompleteSize && !looksLikeVariantSizes) {
    const fromText = parseCombinedSize(blob);
    if (fromText) {
      found.length = Math.max(found.length, fromText.length);
      found.width = Math.max(found.width, fromText.width);
      found.height = Math.max(found.height, fromText.height);
    }
    found.length = Math.max(found.length, parseLongestEdgeFromText(blob));
  }
  if (!found.weightBrutto && !productWeight) {
    const textWeight = parseWeightFromText(blob);
    if (textWeight) {
      found.weightBrutto = textWeight;
      productWeight = textWeight;
    }
  }

  let weightKg = 0;
  if (productWeight > 0) {
    weightKg = Math.max(hasExplicitBrutto ? found.weightBrutto : 0, toGrossKg(productWeight));
  } else if (hasExplicitBrutto && found.weightBrutto > 0) {
    weightKg = ceilKg(found.weightBrutto);
  } else if (found.weightBrutto > 0) {
    weightKg = toGrossKg(found.weightBrutto);
  }

  const toShippingEdge = (value: number) => {
    const packed = Math.max(1, Math.ceil(hasExplicitPackageSize ? value : value + PACK_EDGE_CM));
    return packed > WB_MAX_PACKAGE_EDGE_CM ? Math.min(WB_MAX_PACKAGE_EDGE_CM, Math.ceil(value)) : packed;
  };

  return {
    ...(found.length > 0 ? { length: toShippingEdge(found.length) } : {}),
    ...(found.width > 0 ? { width: toShippingEdge(found.width) } : {}),
    ...(found.height > 0 ? { height: toShippingEdge(found.height) } : {}),
    ...(weightKg > 0 ? { weightBrutto: weightKg } : {}),
  };
}

export function inspectPackageDimensions(
  specs: Array<{ name: string; value: string }>,
  source?: PackageDimensionSource,
): PackageDimensionGaps {
  const dimensions = mapPackageDimensions(specs, source);
  return { dimensions, ...packageDimensionGaps(dimensions) };
}
