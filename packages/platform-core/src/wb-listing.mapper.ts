import { hasPackageDimensionValue, mapPackageDimensions } from '@aiecom/shared';
import {
  WbCardCharacteristic,
  WbCardSize,
  WbCardUploadItem,
  WbCharacteristicMeta,
  WbDirectoryItem,
  WbProductDraft,
  WbSubject,
} from './wb-listing.types';

export { mapPackageDimensions as mapWbDimensions, parseDimensionNumber } from '@aiecom/shared';

const CHAR_ALIASES: Record<string, string[]> = {
  color: ['цвет', 'color', 'colour', '颜色', 'цвет товара'],
  brand: ['бренд', 'brand', '品牌', 'торговая марка', 'бренд производителя'],
  country: ['страна', 'country', 'страна производства', 'страна-производитель', '产地', 'производитель страна'],
  gender: ['пол', 'gender', '性别', 'назначение', 'пол покупателя'],
  composition: ['состав', 'composition', 'материал', 'material', '成分', 'состав ткани'],
  season: ['сезон', 'season', '季节'],
  vat: ['ндс', 'vat', 'ставка ндс', 'налог'],
  hs: ['тн вэд', 'тнвэд', 'tnved', 'hs', 'код тн', 'hs-код', 'hs code', 'код тн вэд'],
  article: ['артикул производителя', 'код производителя', 'артикул поставщика'],
};

const SIZE_KEYS = ['размер', 'size', '尺码', 'рос размер', 'рост', 'eu size', 'ru size', 'размер производителя'];
/** 服装/鞋帽类目才允许 techSize / wbSize；家居、食品等无尺码类目禁止填写 */
const SIZED_CATEGORY_HINTS = [
  'одежд',
  'блуз',
  'рубаш',
  'футбол',
  'плать',
  'юбк',
  'брюк',
  'джинс',
  'куртк',
  'обув',
  'кроссов',
  'носк',
  'бель',
  'белье',
  'худи',
  'свитер',
  'пальто',
  'костюм',
  'пижам',
  'шапк',
  'перчат',
  'колгот',
  'сапог',
  'туфл',
  'ботин',
  'леггинс',
  'шорт',
  'купальн',
  'лифчик',
  'бюстгал',
  'кепк',
  'тапоч',
  'сандал',
  'shirt',
  'dress',
  'blouse',
  'shoes',
  'sneaker',
];
/** 无店铺/采集品牌时，优先从目录里挑这些通用品牌提交给 WB */
const WB_GENERIC_BRANDS = ['NoName', 'Нет бренда', 'Без бренда', 'noname', 'no name'];
const CATEGORY_HINTS = [
  'одежд',
  'блуз',
  'рубаш',
  'футбол',
  'плать',
  'юбк',
  'брюк',
  'джинс',
  'куртк',
  'обув',
  'кроссов',
  'игруш',
  'косме',
  'электро',
  'телефон',
  'сумк',
  'бел',
  'носк',
  'пальто',
  'свитер',
  'худи',
  'костюм',
  'пижам',
  'спорт',
  'shirt',
  'dress',
  'blouse',
  'toy',
  'хозяйств',
  'товар',
  'инвентар',
  'уборк',
  'аксессуар',
  'кухн',
  'посуд',
  'чистк',
  'швабр',
  'мебел',
  'хранен',
  'текстил',
  'сад',
];
const COLOR_SYNONYMS: Record<string, string> = {
  black: 'черный',
  'черный': 'черный',
  'чёрный': 'черный',
  '黑色': 'черный',
  '黑': 'черный',
  white: 'белый',
  'белый': 'белый',
  '白色': 'белый',
  '白': 'белый',
  red: 'красный',
  'красный': 'красный',
  '红色': 'красный',
  '红': 'красный',
  blue: 'синий',
  'синий': 'синий',
  '蓝色': 'синий',
  '蓝': 'синий',
  green: 'зеленый',
  'зеленый': 'зеленый',
  'зелёный': 'зеленый',
  '绿色': 'зеленый',
  beige: 'бежевый',
  'бежевый': 'бежевый',
  '米色': 'бежевый',
  pink: 'розовый',
  'розовый': 'розовый',
  '粉色': 'розовый',
  gray: 'серый',
  grey: 'серый',
  'серый': 'серый',
  '灰色': 'серый',
  brown: 'коричневый',
  'коричневый': 'коричневый',
  '棕色': 'коричневый',
  yellow: 'желтый',
  'желтый': 'желтый',
  'жёлтый': 'желтый',
  '黄色': 'желтый',
};

export function stripWbForbiddenChars(text: string): string {
  return String(text || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** WB 卖家货号直接用 Ozon SKU，不加 OZ 前缀（带 OZ 易被平台风控下架） */
export function buildWbVendorCode(skuId: string): string {
  const compact = String(skuId || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  const withoutLegacyPrefix = compact.startsWith('OZ') && /^OZ\d+$/.test(compact) ? compact.slice(2) : compact;
  return (withoutLegacyPrefix || Date.now().toString(36).toUpperCase()).slice(0, 36);
}

/** 历史曾用 OZ{sku} 建卡，查卡时兼容旧货号 */
export function wbVendorCodeLookupKeys(skuId: string): string[] {
  const primary = buildWbVendorCode(skuId);
  const legacy = primary ? `OZ${primary}`.slice(0, 36) : '';
  return [...new Set([primary, legacy].filter(Boolean))];
}

/** WB 卖家货号 → Ozon SKU（兼容旧 OZ 前缀） */
export function parseOzonSkuFromVendorCode(vendorCode?: string | null): string | null {
  const raw = String(vendorCode || '').trim().toUpperCase();
  const withPrefix = raw.match(/^OZ([0-9]{5,})$/);
  if (withPrefix?.[1]) {
    return withPrefix[1];
  }
  const bare = raw.match(/^([0-9]{5,})$/);
  return bare?.[1] || null;
}

/** 标题去掉第三方品牌词，避免 WB 以未授权品牌拦截卡片 */
export function buildWbTitle(name: string, brand?: string | null, categoryPath?: string | null): string {
  let title = stripWbForbiddenChars(name);
  const banned = [brand, lastCategorySegment(categoryPath)].filter((item): item is string => Boolean(item && looksLikeBrand(item)));
  for (const word of banned) {
    title = title.replace(new RegExp(escapeRegExp(word), 'ig'), ' ').replace(/\s+/g, ' ').trim();
  }
  if (title.length < 6) {
    const category = categorySegments(categoryPath).filter((item) => !looksLikeBrand(item)).pop();
    title = stripWbForbiddenChars(category || name) || 'Товар';
  }
  return title.slice(0, 60) || 'Товар';
}

/** 服装类目上限 2000；按码点截断并留余量，避免 WB 计数口径差异导致拒卡 */
const WB_DESCRIPTION_MIN = 1000;
const WB_DESCRIPTION_MAX = 1900;

export function clipWbText(text: string, max: number): string {
  const chars = Array.from(String(text || ''));
  if (chars.length <= max) {
    return chars.join('');
  }
  return chars.slice(0, max).join('');
}

export function buildWbDescription(
  description?: string | null,
  specs: Array<{ name: string; value: string }> = [],
  extra?: { skuId?: string; name?: string; categoryPath?: string | null; colors?: string[]; brand?: string | null },
): string {
  const skipSpecNames = new Set(['商品描述', 'описание', 'description']);
  const isCjkHeavy = (value: string) => {
    const chars = Array.from(value);
    if (!chars.length) {
      return false;
    }
    const cjk = chars.filter((ch) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)).length;
    return cjk / chars.length > 0.3;
  };
  const specText = specs
    .filter(
      (item) =>
        item.name &&
        item.value &&
        !skipSpecNames.has(normalizeKey(item.name)) &&
        item.name !== '商品描述' &&
        !isCjkHeavy(item.value),
    )
    .slice(0, 12)
    .map((item) => `${item.name}: ${clipWbText(String(item.value), 80)}`)
    .join('\n');
  const specDescription = specs.find((item) => item.name === '商品描述')?.value;
  const colors = extra?.colors?.filter(Boolean).join(', ');
  const vendorCode = extra?.skuId ? buildWbVendorCode(extra.skuId) : '';
  const main = stripWbForbiddenChars(description || specDescription || extra?.name || '');
  const parts = [
    clipWbText(isCjkHeavy(main) ? '' : main, 600) || clipWbText(stripWbForbiddenChars(extra?.name || 'Товар'), 120),
    extra?.categoryPath
      ? `Категория: ${stripWbForbiddenChars(
          categorySegments(extra.categoryPath)
            .filter((item) => !looksLikeBrand(item))
            .join(' / '),
        )}`
      : '',
    colors ? `Цвет: ${stripWbForbiddenChars(colors)}` : '',
    specText,
    extra?.skuId ? `Артикул Ozon: ${extra.skuId}. Артикул продавца WB: ${vendorCode}.` : '',
  ].filter(Boolean);
  let text = parts.join('\n\n');
  if (extra?.brand) {
    text = text.replace(new RegExp(escapeRegExp(extra.brand), 'ig'), ' ').replace(/\s+/g, ' ');
  }
  text = stripWbForbiddenChars(text);
  const filler =
    ' Характеристики соответствуют описанию. Перед использованием ознакомьтесь с составом и рекомендациями по уходу. Товар предназначен для розничной продажи.';
  while (Array.from(text).length < WB_DESCRIPTION_MIN) {
    const room = WB_DESCRIPTION_MAX - Array.from(text).length;
    if (room <= 0) {
      break;
    }
    text += clipWbText(filler, room);
  }
  return clipWbText(text, WB_DESCRIPTION_MAX);
}

export function buildSubjectQueries(categoryPath?: string | null, _name?: string): string[] {
  const parts = categorySegments(categoryPath).filter((item) => !looksLikeBrand(item));
  const queries: string[] = [];
  for (const part of [...parts].reverse()) {
    queries.push(part);
    for (const piece of part.split(/\s+(?:и|для|из|с)\s+|[,&]/i)) {
      const trimmed = piece.trim();
      if (trimmed.length >= 4 && trimmed !== part) {
        queries.push(trimmed);
      }
    }
  }
  return [...new Set(queries.map((item) => item.slice(0, 60)))].filter((item) => item.length >= 2);
}

export function pickWbSubject(subjects: WbSubject[], queries: string[]): WbSubject | null {
  if (!subjects.length) {
    return null;
  }
  let best: { subject: WbSubject; score: number } | null = null;
  for (const subject of subjects) {
    const name = normalizeKey(subject.subjectName);
    const parent = normalizeKey(subject.parentName || '');
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const query = queries[queryIndex];
      const q = normalizeKey(query);
      if (!q) {
        continue;
      }
      let score = 0;
      if (name === q) {
        score = 100;
      } else if (name.includes(q) || q.includes(name)) {
        score = 70 + Math.min(name.length, q.length);
        if (name.includes(q) && name.split(' ').length - q.split(' ').length >= 2) {
          score -= 30;
        }
      } else {
        const tokens = q.split(' ').filter((item) => item.length >= 3);
        const hits = tokens.filter((token) => name.includes(token) || parent.includes(token) || stemClose(name, token)).length;
        if (hits) {
          score = 40 + hits * 15;
        } else if (stemClose(name, q)) {
          score = 55;
        }
      }
      if (score) {
        score += Math.max(0, 24 - queryIndex * 6);
      }
      if (score && (!best || score > best.score)) {
        best = { subject, score };
      }
    }
  }
  return best && best.score >= 25 ? best.subject : null;
}

function isSizeDimensionKey(key: string): boolean {
  const keyNorm = normalizeKey(key)
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (SIZE_KEYS.some((alias) => keyNorm.includes(alias.replace(/\./g, ' ')))) {
    return true;
  }
  return keyNorm === 'рост' || keyNorm === 'eu' || keyNorm === 'ru';
}

function looksLikeSizedCategory(subject?: { subjectName?: string; parentName?: string }, categoryPath?: string | null): boolean {
  const blob = normalizeKey([subject?.subjectName, subject?.parentName, categoryPath].filter(Boolean).join(' '));
  return SIZED_CATEGORY_HINTS.some((hint) => blob.includes(hint));
}

function draftHasSizeOptions(draft?: Pick<WbProductDraft, 'skuOptions'>): boolean {
  return (draft?.skuOptions || []).some((item) =>
    Object.keys(item.options || {}).some((key) => isSizeDimensionKey(key)),
  );
}

/**
 * 是否按尺码建卡：以 WB 类目 isSize / 尺码目录为准。
 * 禁止用 Ozon 规格里的「Размер」去猜——家居、食品类目填尺码会被拒。
 */
export function isWbSizedCategory(input: {
  subject?: { isSize?: boolean; subjectName?: string; parentName?: string };
  charcs?: Array<{ name: string }>;
  sizeDirectory?: string[];
  draft?: Pick<WbProductDraft, 'skuOptions' | 'categoryPath'>;
}): boolean {
  if (input.subject?.isSize === false) {
    return false;
  }
  if (input.subject?.isSize === true) {
    return true;
  }
  if ((input.sizeDirectory || []).some((item) => String(item || '').trim())) {
    return true;
  }
  const clothing = looksLikeSizedCategory(input.subject, input.draft?.categoryPath);
  if (!clothing) {
    return false;
  }
  const hasSizeChar = (input.charcs || []).some((item) => isSizeDimensionKey(item.name));
  return hasSizeChar || draftHasSizeOptions(input.draft);
}

/** 服装/鞋帽等有尺码类目才允许填写 techSize / wbSize；咖啡等无尺码类目只能传条码 */
export function isWbSizedDraft(
  draft: Pick<WbProductDraft, 'skuOptions' | 'categoryPath'>,
  subject?: { isSize?: boolean; subjectName?: string; parentName?: string },
  charcs?: Array<{ name: string }>,
): boolean {
  return isWbSizedCategory({ subject, charcs, draft });
}

/** 选定要提交给 WB 的品牌名；是否通过由 WB 接口判定，本地不因目录未命中而拦截 */
export function resolveWbBrand(input: {
  preferred?: string | null;
  crawled?: string | null;
  directory?: string[];
}): string {
  const directory = (input.directory || []).map((item) => String(item || '').trim()).filter(Boolean);
  const items = directory.map((name) => ({ name }));
  const preferred = String(input.preferred || '').trim();
  if (preferred) {
    return matchDirectory(preferred, items) || preferred;
  }
  const crawled = String(input.crawled || '').trim();
  if (crawled) {
    return matchDirectory(crawled, items) || crawled;
  }
  const generic = directory.find((name) => isGenericBrandName(name));
  return generic || directory[0] || 'NoName';
}

function isGenericBrandName(value: string): boolean {
  const key = normalizeKey(value).replace(/\s+/g, '');
  return WB_GENERIC_BRANDS.some((item) => normalizeKey(item).replace(/\s+/g, '') === key);
}

export function isWbDraftRecreateError(message: string): boolean {
  return /безразмерн|размер и рос|бренд\s*«[^»]+»\s*не найден|бренд.*не найден/i.test(String(message || ''));
}

export function existingCardHasForbiddenSizes(
  sizes: Array<{ techSize?: string; wbSize?: string }> | undefined,
): boolean {
  return (sizes || []).some((item) => {
    const tech = String(item.techSize || '').trim();
    const wbSize = String(item.wbSize || '').trim();
    return Boolean(wbSize) || (tech !== '' && tech !== '0');
  });
}

/** 每个可下单 SKU 对应一个 WB techSize：尺码优先，否则用克重/口味等规格值 */
export function skuTechSize(option: {
  skuId?: string;
  name?: string;
  options?: Record<string, string> | null;
}): string {
  const entries = Object.entries(option.options || {}).filter(([, value]) => String(value || '').trim());
  const sizeEntry = entries.find(([key]) => isSizeDimensionKey(key));
  if (sizeEntry?.[1]) {
    return String(sizeEntry[1]).slice(0, 30);
  }
  if (entries.length) {
    return entries
      .map(([, value]) => String(value))
      .join(' / ')
      .slice(0, 30);
  }
  return '0';
}

export function mapWbSizes(
  draft: WbProductDraft,
  barcodes: string[],
  options?: { sized?: boolean },
): WbCardSize[] {
  const skuOptions = draft.skuOptions?.length
    ? draft.skuOptions
    : [{ skuId: draft.skuId, name: draft.name, price: draft.price, options: {} }];
  const fallbackPrice = Math.max(1, Math.round(Number(draft.price) || 1));
  const sized = options?.sized ?? isWbSizedDraft(draft);
  // 无尺码类目禁止填写 Размер / Рос.Размер，只保留一条条码
  if (!sized) {
    return [
      {
        techSize: '0',
        price: Math.max(1, Math.round(Number(skuOptions[0]?.price) || fallbackPrice)),
        skus: [barcodes[0]].filter((item): item is string => Boolean(item)),
      },
    ];
  }
  const used = new Map<string, number>();
  return skuOptions.map((option, index) => {
    let label = skuTechSize(option);
    const seen = (used.get(label) || 0) + 1;
    used.set(label, seen);
    if (seen > 1) {
      const suffix = `-${seen}`;
      label = `${label.slice(0, Math.max(1, 30 - suffix.length))}${suffix}`;
    }
    return {
      techSize: label,
      wbSize: label === '0' ? undefined : label,
      price: Math.max(1, Math.round(Number(option.price) || fallbackPrice)),
      skus: [barcodes[index] || barcodes[0]].filter(Boolean),
    };
  });
}

export function countMissingWbSizes(
  wantedTechSizes: string[],
  existingTechSizes: Array<string | undefined>,
): number {
  const have = new Set(existingTechSizes.filter(Boolean));
  return wantedTechSizes.filter((item) => !have.has(item)).length;
}

export function mergeWbCardSizes(
  wanted: WbCardSize[],
  existing: Array<{ chrtID?: number; techSize: string; wbSize?: string; skus: string[] }> = [],
  extraBarcodes: string[] = [],
): Array<{ chrtID?: number; techSize: string; wbSize?: string; skus: string[]; price?: number }> {
  const existingByTech = new Map(existing.map((item) => [item.techSize, item]));
  let extraIndex = 0;
  const merged: Array<{ chrtID?: number; techSize: string; wbSize?: string; skus: string[]; price?: number }> = wanted.map((size) => {
    const tech = size.techSize || '0';
    const prev = existingByTech.get(tech);
    if (prev) {
      return {
        chrtID: prev.chrtID,
        techSize: prev.techSize,
        wbSize: prev.wbSize ?? size.wbSize,
        skus: prev.skus?.length ? prev.skus : size.skus,
        price: size.price,
      };
    }
    const barcode = extraBarcodes[extraIndex++] || size.skus[0];
    return {
      techSize: tech,
      wbSize: size.wbSize,
      skus: [barcode].filter((item): item is string => Boolean(item)),
      price: size.price,
    };
  });
  const wantedTechs = new Set(wanted.map((item) => item.techSize || '0'));
  for (const prev of existing) {
    if (!wantedTechs.has(prev.techSize)) {
      merged.push({
        chrtID: prev.chrtID,
        techSize: prev.techSize,
        wbSize: prev.wbSize,
        skus: prev.skus,
      });
    }
  }
  return merged;
}

export function mapWbCharacteristics(
  charcs: WbCharacteristicMeta[],
  draft: WbProductDraft,
  directories: {
    colors?: WbDirectoryItem[];
    genders?: WbDirectoryItem[];
    countries?: WbDirectoryItem[];
    seasons?: WbDirectoryItem[];
    vat?: string[];
    tnved?: string[];
  } = {},
  options?: { brand?: string | null },
): { characteristics: WbCardCharacteristic[]; missingRequired: string[] } {
  const specs = [...draft.specs];
  const colors = colorsFromDraft(draft);
  if (colors[0]) {
    specs.push({ name: 'цвет', value: colors[0] });
  }
  const characteristics: WbCardCharacteristic[] = [];
  const missingRequired: string[] = [];
  const category = normalizeKey(draft.categoryPath || '');

  for (const charc of charcs) {
    if (SIZE_KEYS.some((alias) => normalizeKey(charc.name).includes(alias))) {
      continue;
    }
    const matchedSpec = findSpecForChar(charc.name, specs);
    let value: string | number | string[] | null = matchedSpec?.value ?? null;
    const aliasGroup = detectAliasGroup(charc.name);
    if (aliasGroup === 'brand') {
      value = options?.brand || null;
    }
    if (aliasGroup === 'article') {
      value = buildWbVendorCode(draft.skuId);
    }
    if (aliasGroup === 'color') {
      const rawColor = String(value || colors[0] || '');
      const synonym = COLOR_SYNONYMS[normalizeKey(rawColor)];
      value =
        matchDirectory(rawColor, directories.colors) ||
        matchDirectory(synonym, directories.colors) ||
        synonym ||
        rawColor ||
        directories.colors?.[0]?.name ||
        null;
    }
    if (aliasGroup === 'gender') {
      const guessed = /женск|women|female/i.test(category) ? 'женский' : /мужск|men|male/i.test(category) ? 'мужской' : value;
      value = matchDirectory(guessed, directories.genders) || guessed || value;
    }
    if (aliasGroup === 'country') {
      value =
        matchDirectory(value, directories.countries) ||
        value ||
        matchDirectory('китай', directories.countries) ||
        matchDirectory('china', directories.countries);
    }
    if (aliasGroup === 'season') {
      value = matchDirectory(value, directories.seasons) || value;
    }
    if (aliasGroup === 'vat') {
      value = matchVat(value, directories.vat) || directories.vat?.[0] || value;
    }
    if (aliasGroup === 'hs') {
      value = value || pickTnved(directories.tnved);
    }
    if (value == null || value === '') {
      if (charc.required) {
        missingRequired.push(charc.name);
      }
      continue;
    }
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (charc.charcType === 4 && Number.isFinite(numeric)) {
      characteristics.push({ id: charc.charcID, value: numeric });
    } else {
      const list = Array.isArray(value) ? value : [String(value)];
      characteristics.push({ id: charc.charcID, value: list.map((item) => String(item).slice(0, 1000)) });
    }
  }
  return { characteristics, missingRequired };
}

export function buildWbUploadPayload(input: {
  subject: WbSubject;
  draft: WbProductDraft;
  vendorCode: string;
  barcodes: string[];
  characteristics: WbCardCharacteristic[];
  brand: string;
  sized?: boolean;
}): WbCardUploadItem[] {
  const dimensions = mapPackageDimensions(input.draft.specs, input.draft);
  const sized = input.sized ?? isWbSizedDraft(input.draft, input.subject);
  const mapped = mapWbSizes(input.draft, input.barcodes, { sized }).filter((item) => item.skus.length);
  const fallback = [
    {
      ...(sized ? { techSize: '0' } : {}),
      price: Math.max(1, Math.round(input.draft.price || 1)),
      skus: input.barcodes.slice(0, 1),
    },
  ];
  const sizes = (mapped.length ? mapped : fallback).map((item) =>
    sized
      ? item
      : {
          skus: item.skus,
          price: item.price,
        },
  );
  return [
    {
      subjectID: input.subject.subjectID,
      variants: [
        {
          vendorCode: input.vendorCode,
          title: buildWbTitle(input.draft.name, input.draft.brand, input.draft.categoryPath),
          description: buildWbDescription(input.draft.description, input.draft.specs, {
            skuId: input.draft.skuId,
            name: input.draft.name,
            categoryPath: input.draft.categoryPath,
            colors: colorsFromDraft(input.draft),
            brand: input.draft.brand,
          }),
          brand: input.brand,
          ...(hasPackageDimensionValue(dimensions) ? { dimensions } : {}),
          characteristics: input.characteristics,
          sizes,
        },
      ],
    },
  ];
}

export function collectImageUrls(draft: WbProductDraft): string[] {
  const all = [
    ...draft.imageUrls,
    ...draft.skuOptions.flatMap((item) => item.imageUrls || []),
  ];
  const byId = new Map<string, string>();
  for (const raw of all) {
    if (!/^https?:\/\//i.test(raw)) {
      continue;
    }
    const url = normalizeOzonImageUrl(raw);
    const id = url.split('/').pop() || url;
    if (!byId.has(id)) {
      byId.set(id, url);
    }
  }
  return [...byId.values()].slice(0, 30);
}

export function colorsFromDraft(draft: WbProductDraft): string[] {
  const colors = new Set<string>();
  for (const spec of draft.specs) {
    if (detectAliasGroup(spec.name) === 'color' && spec.value) {
      colors.add(spec.value);
    }
  }
  for (const option of draft.skuOptions) {
    for (const [key, value] of Object.entries(option.options || {})) {
      if (value && (detectAliasGroup(key) === 'color' || normalizeKey(key) === 'цвет')) {
        colors.add(String(value));
      }
    }
  }
  return [...colors];
}

export function normalizeOzonImageUrl(url: string): string {
  return String(url || '').replace(/\/(c\d+|wc\d+|wcs\d+)\//i, '/');
}

function categorySegments(categoryPath?: string | null): string[] {
  return String(categoryPath || '')
    .split(/[/|>·,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stemClose(a: string, b: string): boolean {
  const min = Math.min(a.length, b.length);
  if (min < 4) {
    return false;
  }
  let common = 0;
  while (common < min && a[common] === b[common]) {
    common += 1;
  }
  return common >= 4;
}

function pickTnved(codes?: string[]): string | null {
  if (!codes?.length) {
    return null;
  }
  return [...codes].sort((left, right) => right.replace(/\D/g, '').length - left.replace(/\D/g, '').length)[0];
}

function lastCategorySegment(categoryPath?: string | null): string | undefined {
  const parts = categorySegments(categoryPath);
  return parts[parts.length - 1];
}

function looksLikeBrand(segment: string): boolean {
  const key = normalizeKey(segment);
  if (CATEGORY_HINTS.some((hint) => key.includes(hint))) {
    return false;
  }
  if (/(^|\s)(для|и)(\s|$)/.test(key)) {
    return false;
  }
  const words = segment.trim().split(/\s+/);
  if (words.length > 2 || segment.length > 24) {
    return false;
  }
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_:/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectAliasGroup(name: string): keyof typeof CHAR_ALIASES | null {
  const key = normalizeKey(name);
  for (const [group, aliases] of Object.entries(CHAR_ALIASES)) {
    if (aliases.some((alias) => key.includes(alias))) {
      return group as keyof typeof CHAR_ALIASES;
    }
  }
  return null;
}

function findSpecForChar(charName: string, specs: Array<{ name: string; value: string }>) {
  const charKey = normalizeKey(charName);
  const aliases = Object.values(CHAR_ALIASES).find((list) => list.some((alias) => charKey.includes(alias))) || [];
  return (
    specs.find((spec) => normalizeKey(spec.name) === charKey) ||
    specs.find((spec) => aliases.some((alias) => normalizeKey(spec.name).includes(alias))) ||
    specs.find((spec) => charKey.includes(normalizeKey(spec.name)) || normalizeKey(spec.name).includes(charKey))
  );
}

function matchDirectory(value: string | number | string[] | null, items?: WbDirectoryItem[]): string | null {
  if (!items?.length || value == null) {
    return null;
  }
  const raw = Array.isArray(value) ? value[0] : String(value);
  const key = normalizeKey(raw);
  const exact = items.find((item) => normalizeKey(item.name) === key);
  if (exact) {
    return exact.name;
  }
  const fuzzy = items.find((item) => normalizeKey(item.name).includes(key) || key.includes(normalizeKey(item.name)));
  return fuzzy?.name || null;
}

function matchVat(value: string | number | string[] | null, items?: string[]): string | null {
  if (!items?.length) {
    return null;
  }
  const raw = value == null ? '' : Array.isArray(value) ? value[0] : String(value);
  const key = normalizeKey(raw);
  return items.find((item) => normalizeKey(item) === key) || items.find((item) => /0|без|не облаг/i.test(item)) || items[0];
}
