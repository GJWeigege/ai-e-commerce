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
/**
 * 这些类目在 WB 一律是「безразмерный товар」，填 Размер / Рос.Размер 会被直接拒卡。
 * 优先级高于 SIZED_CATEGORY_HINTS：家纺里的「бельё」「шапка для сна」等词很容易误命中服装规则。
 */
const NON_SIZED_CATEGORY_HINTS = [
  'подушк',
  'одеял',
  'плед',
  'покрывал',
  'наматрасник',
  'простын',
  'наволочк',
  'пододеяльник',
  'наперник',
  'постельн',
  'домашний текстил',
  'текстиль для дома',
  'полотенц',
  'скатерт',
  'салфетк',
  'штор',
  'занавес',
  'коврик',
  'матрас',
  'топпер',
  'посуд',
  'кастрюл',
  'кружк',
  'стакан',
  'кофе',
  'чай',
  'бытовая техника',
  'инвентар',
  'уборк',
  'швабр',
  'мебел',
  'хранен',
  'игруш',
  'космет',
  'парфюм',
  'канцеляр',
  'инструмент',
  'зоотовар',
  'корм',
  'продукт',
  'напитк',
  'грелк',
  'светильник',
  'лампа',
  'кабел',
  'зарядн',
];
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
  'нижнее бел',
  'трус',
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
/** 单个类目品牌表截断，避免服装类目上万品牌拖垮内存和落盘 */
export const WB_BRAND_DIRECTORY_CAP = 2500;
/** 超过该数量不再做模糊匹配，只走规范化精确命中 */
const WB_BRAND_FUZZY_LIMIT = 800;

const brandExactIndexCache = new WeakMap<readonly string[], Map<string, string>>();
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
  'постельн',
  'подушк',
  'одеял',
  'плед',
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
  orange: 'оранжевый',
  'оранжевый': 'оранжевый',
  '橙色': 'оранжевый',
  purple: 'фиолетовый',
  violet: 'фиолетовый',
  'фиолетовый': 'фиолетовый',
  '紫色': 'фиолетовый',
  gold: 'золотой',
  'золотой': 'золотой',
  '金色': 'золотой',
  silver: 'серебряный',
  'серебряный': 'серебряный',
  '银色': 'серебряный',
  turquoise: 'бирюзовый',
  'бирюзовый': 'бирюзовый',
  multicolor: 'разноцветный',
  'разноцветный': 'разноцветный',
  'мультиколор': 'разноцветный',
  '彩色': 'разноцветный',
  transparent: 'прозрачный',
  'прозрачный': 'прозрачный',
  '透明': 'прозрачный',
};
/** 兜底颜色候选：目录型颜色特性必填但采集值不是颜色时使用 */
const COLOR_FALLBACKS = ['разноцветный', 'мультиколор', 'белый', 'бесцветный'];
/**
 * Ozon 常把「Цвет」当变体轴用，值里塞的是填充物 / 配件 / 套装说明。
 * 这些词一旦出现就说明整段不是颜色，直接丢弃，否则 WB 报「Недопустимое значение цвета」。
 */
const COLOR_NON_VALUE_HINTS = [
  'чехол',
  'пух',
  'лебяж',
  'наполнител',
  'комплект',
  'набор',
  'размер',
  'упаковк',
  'модел',
  'рисунок',
  'принт',
  'вариант',
  'микрофибр',
  'бамбук',
  'сатин',
  'поплин',
  'подушк',
  'одеял',
  'навол',
  'ткан',
  'вес',
  'объем',
  'мощност',
  'шт',
  ' см',
  ' мм',
];

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
export const WB_DESCRIPTION_MAX = 1900;

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
  extra?: {
    skuId?: string;
    name?: string;
    categoryPath?: string | null;
    colors?: string[];
    brand?: string | null;
    /** 类目描述上限。WB 各类目口径不同，被拒后由自愈流程收紧 */
    maxLength?: number;
  },
): string {
  const maxLength = Math.max(80, Math.min(extra?.maxLength || WB_DESCRIPTION_MAX, WB_DESCRIPTION_MAX));
  const minLength = Math.min(WB_DESCRIPTION_MIN, Math.floor(maxLength * 0.6));
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
  while (Array.from(text).length < minLength) {
    const room = maxLength - Array.from(text).length;
    if (room <= 0) {
      break;
    }
    text += clipWbText(filler, room);
  }
  return clipWbText(text, maxLength);
}

/** Ozon 面包屑/标题 → WB 可搜到的 subject 名。Ozon「Дом и сад」在 WB 常叫「Для дома」。 */
const OZON_WB_SUBJECT_ALIASES: Array<{ test: (blob: string) => boolean; queries: string[] }> = [
  {
    test: (blob) => /электроподогрев|электрогрелк|электроодеял|\bгрелк/.test(blob),
    queries: ['электрогрелки', 'электроодеяла', 'грелки'],
  },
  {
    test: (blob) => /подушк/.test(blob),
    queries: ['подушки', 'подушка'],
  },
  {
    test: (blob) => /одеял/.test(blob),
    queries: ['одеяла', 'одеяло'],
  },
  {
    test: (blob) => /плед/.test(blob),
    queries: ['пледы', 'плед'],
  },
  {
    test: (blob) => /наволочк/.test(blob),
    queries: ['наволочки', 'наволочка'],
  },
  {
    test: (blob) => /постельн|домашний текстил/.test(blob) && !/подушк|одеял|плед|наволочк/.test(blob),
    queries: ['постельное белье', 'текстиль для дома'],
  },
  {
    test: (blob) => /текстиль/.test(blob),
    queries: ['текстиль для дома', 'пледы', 'одеяла', 'покрывала'],
  },
  {
    test: (blob) => /дом и сад|для дома/.test(blob),
    queries: ['для дома', 'дом'],
  },
  {
    test: (blob) => /(^|\s)сад(\s|$)/.test(blob) || /дача/.test(blob),
    queries: ['сад и дача'],
  },
];

function stemRussianToken(value: string): string {
  return String(value || '').replace(/(ами|ями|ом|ем|ой|ей|ах|ях|ов|ев|иями|ием|ию|ия|ии)$/i, '');
}

export function buildSubjectQueries(categoryPath?: string | null, name?: string): string[] {
  const parts = categorySegments(categoryPath).filter((item) => !looksLikeBrand(item));
  const queries: string[] = [];
  const push = (raw: string) => {
    const item = stripWbForbiddenChars(raw).slice(0, 60).trim();
    if (item.length >= 2) {
      queries.push(item);
    }
  };
  for (const part of [...parts].reverse()) {
    push(part);
    const stemmedPart = stemRussianToken(part);
    if (stemmedPart !== part && stemmedPart.length >= 4) {
      push(stemmedPart);
    }
    for (const piece of part.split(/\s+(?:и|для|из|с|со)\s+|[,&]/i)) {
      const trimmed = piece.trim();
      if (trimmed.length >= 4 && trimmed !== part) {
        push(trimmed);
        const stemmed = stemRussianToken(trimmed);
        if (stemmed !== trimmed && stemmed.length >= 4) {
          push(stemmed);
        }
      }
    }
  }
  const blob = normalizeKey([categoryPath, name].filter(Boolean).join(' '));
  for (const alias of OZON_WB_SUBJECT_ALIASES) {
    if (alias.test(blob)) {
      alias.queries.forEach(push);
    }
  }
  const nameTokens = String(name || '')
    .split(/[\s,/|]+/)
    .map((item) => item.replace(/[^A-Za-zА-Яа-яЁё-]/g, ''))
    .filter((item) => item.length >= 5 && !looksLikeBrand(item));
  for (const token of nameTokens.slice(0, 4)) {
    push(token);
    const stemmed = stemRussianToken(token);
    if (stemmed.length >= 4 && stemmed !== token) {
      push(stemmed);
    }
  }
  return [...new Set(queries)];
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

/**
 * 是否是服装口径的尺码值：S / M / XL / 42 / 46-48。
 * 「50x70 см」「1.5 кг」这类是物理尺寸或规格，填进 WB 尺码会触发「безразмерный товар」拒卡。
 */
const ONE_SIZE_VALUE_HINTS = [
  'единый',
  'универсал',
  'безразмер',
  'один размер',
  'one size',
  'onesize',
  'free size',
  'freesize',
  'one-size',
  '均码',
];

/** 均码 / one size / единый размер：这类值不能当 WB 服装尺码提交 */
export function looksLikeOneSizeValue(value: string): boolean {
  const raw = normalizeKey(value)
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) {
    return false;
  }
  if (/^(os|free|onesize|one size)$/.test(raw)) {
    return true;
  }
  return ONE_SIZE_VALUE_HINTS.some((hint) => raw.includes(hint));
}

export function looksLikeApparelSizeValue(value: string): boolean {
  // 不走 normalizeKey：它会把 `-` `/` 变成空格，「46-48」这类区间尺码会被拼成 4 位数
  const raw = String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, '')
    .trim();
  if (!raw || raw.length > 12) {
    return false;
  }
  if (/[xх×*]\d/.test(raw)) {
    return false;
  }
  if (/(см|cm|мм|mm|kg|кг|мл|ml|шт|гр|г$)/.test(raw)) {
    return false;
  }
  return /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl|\d{2,3}(?:[-/]\d{2,3})?)$/.test(raw);
}

/** 类目文本命中无尺码关键词 */
function looksLikeNonSizedCategory(text?: string | null): boolean {
  const blob = normalizeKey(text || '');
  return Boolean(blob) && NON_SIZED_CATEGORY_HINTS.some((hint) => blob.includes(hint));
}

function looksLikeSizedCategory(text?: string | null): boolean {
  const blob = normalizeKey(text || '');
  return Boolean(blob) && SIZED_CATEGORY_HINTS.some((hint) => blob.includes(hint));
}

function collectDraftSizeTexts(draft?: Pick<WbProductDraft, 'skuOptions' | 'name'>): string[] {
  const values: string[] = [];
  for (const option of draft?.skuOptions || []) {
    if (option.name) {
      values.push(option.name);
    }
    for (const [key, value] of Object.entries(option.options || {})) {
      if (isSizeDimensionKey(key) && value) {
        values.push(String(value));
      }
    }
  }
  return values;
}

function draftHasApparelSizeOptions(draft?: Pick<WbProductDraft, 'skuOptions' | 'name'>): boolean {
  return collectDraftSizeTexts(draft).some((value) => looksLikeApparelSizeValue(value));
}

function draftLooksOneSize(draft?: Pick<WbProductDraft, 'skuOptions' | 'name'>): boolean {
  const sizeValues = (draft?.skuOptions || []).flatMap((item) =>
    Object.entries(item.options || {})
      .filter(([key, value]) => isSizeDimensionKey(key) && value)
      .map(([, value]) => String(value)),
  );
  if (sizeValues.length && sizeValues.every((value) => looksLikeOneSizeValue(value) || !looksLikeApparelSizeValue(value))) {
    return !sizeValues.some((value) => looksLikeApparelSizeValue(value));
  }
  const blob = [draft?.name, ...(draft?.skuOptions || []).map((item) => item.name), ...sizeValues].filter(Boolean).join(' ');
  return looksLikeOneSizeValue(blob);
}

/**
 * 是否按尺码建卡：默认不填 Размер，避免均码/配件/家居被拒卡。
 * 只有同时满足「采集到服装口径尺码（S/M/42）」且「类目像服装鞋帽」才提交。
 * WB 若反过来要求必须填尺码，由拒卡自愈补上，不需要运营手工配置。
 */
export function isWbSizedCategory(input: {
  subject?: { isSize?: boolean; subjectName?: string; parentName?: string };
  charcs?: Array<{ name: string }>;
  sizeDirectory?: string[];
  draft?: Pick<WbProductDraft, 'skuOptions' | 'categoryPath' | 'name'>;
}): boolean {
  if (input.subject?.isSize === false) {
    return false;
  }
  const subjectText = [input.subject?.subjectName, input.subject?.parentName].filter(Boolean).join(' ');
  const draftText = [input.draft?.categoryPath, input.draft?.name].filter(Boolean).join(' ');
  const combined = [subjectText, draftText].filter(Boolean).join(' ');
  if (looksLikeNonSizedCategory(combined) || looksLikeNonSizedCategory(subjectText) || looksLikeNonSizedCategory(draftText)) {
    return false;
  }
  if (draftLooksOneSize(input.draft)) {
    return false;
  }
  if (!draftHasApparelSizeOptions(input.draft)) {
    return false;
  }
  return (
    input.subject?.isSize === true ||
    looksLikeSizedCategory(subjectText) ||
    looksLikeSizedCategory(input.draft?.categoryPath)
  );
}

/**
 * 映射表 hint=false 表示 WB 已判定该类目无尺码，必须遵守。
 * hint=true 不能压过本地判定：同类 Ozon 面包屑下既有带尺码服装也有均码配件。
 */
export function resolveWbSizedFlag(input: {
  hintSized?: boolean | null;
  subject?: { isSize?: boolean; subjectName?: string; parentName?: string };
  charcs?: Array<{ name: string }>;
  sizeDirectory?: string[];
  draft?: Pick<WbProductDraft, 'skuOptions' | 'categoryPath' | 'name'>;
}): boolean {
  if (input.hintSized === false) {
    return false;
  }
  return isWbSizedCategory(input);
}

/** 服装/鞋帽等有尺码类目才允许填写 techSize / wbSize；咖啡等无尺码类目只能传条码 */
export function isWbSizedDraft(
  draft: Pick<WbProductDraft, 'skuOptions' | 'categoryPath' | 'name'>,
  subject?: { isSize?: boolean; subjectName?: string; parentName?: string },
  charcs?: Array<{ name: string }>,
): boolean {
  return isWbSizedCategory({ subject, charcs, draft });
}

/**
 * 选定提交给 WB 的品牌。
 * 店铺配置的品牌原样提交（卖家自己备案的）；
 * Ozon 采集品牌只有命中 WB 目录才用，否则改通用品牌 —— 否则会报 «Бренд «…» не найден».
 */
export function resolveWbBrand(input: {
  preferred?: string | null;
  crawled?: string | null;
  directory?: string[];
}): string {
  const preferred = String(input.preferred || '').trim();
  // 店铺备案品牌原样提交，不必扫上万条目录做拼写对齐
  if (preferred) {
    return preferred;
  }
  const directory = (input.directory || []).map((item) => String(item || '').trim()).filter(Boolean);
  const crawled = String(input.crawled || '').trim();
  if (crawled) {
    const matched = matchBrandDirectory(crawled, directory);
    if (matched) {
      return matched;
    }
    if (isGenericWbBrandName(crawled)) {
      return crawled;
    }
  }
  return directory.find((name) => isGenericWbBrandName(name)) || 'NoName';
}

export function isGenericWbBrandName(value: string): boolean {
  const key = normalizeKey(value).replace(/\s+/g, '');
  return WB_GENERIC_BRANDS.some((item) => normalizeKey(item).replace(/\s+/g, '') === key);
}

/** 通用品牌优先保留，再保留调用方关心的名字，其余截到上限 */
export function compactWbBrandDirectory(names: string[], keep: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const name = String(raw || '').trim();
    if (!name) {
      return;
    }
    const key = normalizeKey(name);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(name);
  };
  for (const name of names) {
    if (isGenericWbBrandName(name)) {
      push(name);
    }
  }
  for (const name of keep) {
    const hit = names.find((item) => normalizeKey(item) === normalizeKey(name));
    if (hit) {
      push(hit);
    }
  }
  for (const name of names) {
    if (out.length >= WB_BRAND_DIRECTORY_CAP) {
      break;
    }
    push(name);
  }
  return out;
}

function matchBrandDirectory(value: string, directory: string[]): string | null {
  if (!directory.length) {
    return null;
  }
  const key = normalizeKey(value);
  if (!key) {
    return null;
  }
  let index = brandExactIndexCache.get(directory);
  if (!index) {
    index = new Map();
    for (const name of directory) {
      const itemKey = normalizeKey(name);
      if (itemKey && !index.has(itemKey)) {
        index.set(itemKey, name);
      }
    }
    brandExactIndexCache.set(directory, index);
  }
  const exact = index.get(key);
  if (exact) {
    return exact;
  }
  if (directory.length > WB_BRAND_FUZZY_LIMIT || key.length < 4) {
    return null;
  }
  return matchDirectory(value, directory.map((name) => ({ name })));
}

export function isWbDraftRecreateError(message: string): boolean {
  return /безразмерн|размер и рос|бренд\s*«[^»]+»\s*не найден|бренд.*не найден/i.test(String(message || ''));
}

export type WbCardRepairState = {
  sized: boolean;
  droppedCharcIds: number[];
  descriptionMax: number;
  genericBrand: boolean;
};

export type WbCardRepairPlan = {
  /** 中文原因，写回 listing.error 供运营看懂改了什么 */
  reason: string;
  sized?: boolean;
  dropCharcIds?: number[];
  descriptionMax?: number;
  useGenericBrand?: boolean;
  /** WB 已经把这张卡收进「Черновик」，必须先删草稿再重建 */
  recreate: boolean;
};

/**
 * 把 WB 的拒卡文案翻译成一次可自动执行的修复动作。
 * 返回 null 表示这批报错没有已知的自动修法，交由上层置为失败并展示原文。
 */
export function planWbCardRepair(
  errors: string[],
  context: {
    charcs?: Array<{ charcID: number; name: string }>;
    state: WbCardRepairState;
  },
): WbCardRepairPlan | null {
  const blob = errors.map((item) => String(item || '')).join('\n');
  const state = context.state;
  const charcs = context.charcs || [];
  const dropped = new Set(state.droppedCharcIds);

  if (state.sized && /безразмерн|размер и рос/i.test(blob)) {
    return { reason: 'WB 判定该类目为无尺码商品，已去掉 Размер / Рос.Размер 重建卡片', sized: false, recreate: true };
  }
  if (!state.sized && /(не указан|не заполнен|укажите)[^.;]{0,24}размер|размер[^.;]{0,24}обязат/i.test(blob)) {
    return { reason: 'WB 判定该类目必须填尺码，已按规格补齐 Размер 重建卡片', sized: true, recreate: true };
  }
  if (/недопустимое значение цвета/i.test(blob)) {
    const ids = charcIdsByAlias(charcs, 'color').filter((id) => !dropped.has(id));
    if (ids.length) {
      return { reason: '采集到的颜色不在 WB 颜色目录内，已移除颜色特性重建卡片', dropCharcIds: ids, recreate: true };
    }
  }
  const invalidNames = [...blob.matchAll(/недопустимое значение (?:характеристики\s*)?[«"']([^»"']+)[»"']/gi)].map(
    (match) => match[1],
  );
  const invalidIds = invalidNames
    .flatMap((name) => charcIdsByName(charcs, name))
    .filter((id) => !dropped.has(id));
  if (invalidIds.length) {
    return {
      reason: `WB 拒绝特性值：${invalidNames.join('、')}，已移除后重建卡片`,
      dropCharcIds: invalidIds,
      recreate: true,
    };
  }
  const overflow = blob.match(/не более (\d+) символов/i);
  if (overflow) {
    const limit = Number(overflow[1]);
    if (Number.isFinite(limit) && limit > 0 && limit < state.descriptionMax) {
      return { reason: `WB 该类目描述上限 ${limit} 字符，已截断后重建卡片`, descriptionMax: limit, recreate: true };
    }
  }
  if (!state.genericBrand && /бренд.*не найден/i.test(blob)) {
    return { reason: '店铺品牌未在 WB 备案，已改用通用品牌重建卡片', useGenericBrand: true, recreate: true };
  }
  return null;
}

function charcIdsByAlias(charcs: Array<{ charcID: number; name: string }>, group: keyof typeof CHAR_ALIASES): number[] {
  return charcs.filter((item) => detectAliasGroup(item.name) === group).map((item) => item.charcID);
}

function charcIdsByName(charcs: Array<{ charcID: number; name: string }>, name: string): number[] {
  const key = normalizeKey(name);
  if (!key) {
    return [];
  }
  return charcs
    .filter((item) => {
      const current = normalizeKey(item.name);
      return current === key || current.includes(key) || key.includes(current);
    })
    .map((item) => item.charcID);
}

/** Ozon 面包屑 → 类目映射表主键。大小写/空格/分隔符差异不该产生两条映射 */
export function normalizeOzonCategoryKey(categoryPath?: string | null): string {
  return categorySegments(categoryPath)
    .map((item) => normalizeKey(item))
    .filter(Boolean)
    .join(' / ');
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
  options?: { brand?: string | null; skipCharcIds?: number[] },
): { characteristics: WbCardCharacteristic[]; missingRequired: string[] } {
  const specs = [...draft.specs];
  const colors = colorsFromDraft(draft);
  const characteristics: WbCardCharacteristic[] = [];
  const missingRequired: string[] = [];
  const category = normalizeKey(draft.categoryPath || '');
  // 自愈重试时把 WB 判为非法的特性整条摘掉，而不是继续送同一个值
  const skipped = new Set(options?.skipCharcIds || []);

  for (const charc of charcs) {
    if (skipped.has(charc.charcID)) {
      continue;
    }
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
      value = resolveWbColorValue([String(value || ''), ...colors], directories.colors, { required: charc.required });
    }
    if (aliasGroup === 'gender') {
      const guessed = /женск|women|female/i.test(category) ? 'женский' : /мужск|men|male/i.test(category) ? 'мужской' : value;
      value = pickDirectoryValue(guessed, directories.genders, charc.required ? ['унисекс', 'женский'] : []);
    }
    if (aliasGroup === 'country') {
      value = pickDirectoryValue(value, directories.countries, ['китай', 'china']);
    }
    if (aliasGroup === 'season') {
      value = pickDirectoryValue(value, directories.seasons, charc.required ? ['круглогодичный', 'демисезон'] : []);
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
      const list: string[] = Array.isArray(value) ? value.map((item) => String(item)) : [String(value)];
      const limit = charc.maxCount && charc.maxCount > 0 ? charc.maxCount : list.length;
      characteristics.push({
        id: charc.charcID,
        value: list.slice(0, limit).map((item) => item.slice(0, 1000)),
      });
    }
  }
  return { characteristics, missingRequired };
}

/**
 * 目录型特性取值：目录非空时只允许目录内的值，必要时用兜底候选补齐；
 * 目录为空（接口没拉到）才回落到采集原值，避免因为目录拉取失败卡住上架。
 */
function pickDirectoryValue(
  value: string | number | string[] | null,
  directory?: WbDirectoryItem[],
  fallbacks: string[] = [],
): string | null {
  const matched = matchDirectory(value, directory);
  if (matched) {
    return matched;
  }
  if (!directory?.length) {
    const raw = Array.isArray(value) ? value[0] : value == null ? '' : String(value);
    return raw || null;
  }
  for (const fallback of fallbacks) {
    const hit = matchDirectory(fallback, directory);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function buildWbUploadPayload(input: {
  subject: WbSubject;
  draft: WbProductDraft;
  vendorCode: string;
  barcodes: string[];
  characteristics: WbCardCharacteristic[];
  brand: string;
  sized?: boolean;
  descriptionMax?: number;
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
            maxLength: input.descriptionMax,
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

/** WB 库存接口 2026-05-20 起只接受尺码 ID；Content 返回 chrtID，Marketplace 提交 chrtId */
export function collectWbChrtIds(
  sizes?: Array<{ chrtID?: number; chrtId?: number }> | null,
): number[] {
  return [
    ...new Set(
      (sizes || [])
        .map((item) => Number(item.chrtID ?? item.chrtId))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
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

/**
 * 把采集到的「颜色」原文拆成可校验的候选值。
 * 会剥掉 Ozon 变体去重留下的尾部数字（例：`Лебяжий пух, чехол из микрофибры2`），
 * 并丢弃明显不是颜色的片段。返回空数组表示这个值不该作为颜色提交。
 */
export function sanitizeWbColorValue(raw: string): string[] {
  const stripTail = (value: string) => value.replace(/\s*\d+\s*$/, '').trim();
  const base = stripTail(stripWbForbiddenChars(raw));
  if (!base) {
    return [];
  }
  const pieces = [base, ...base.split(/[,/;|+]|\s+и\s+/)]
    .map(stripTail)
    .map((item) => item.replace(/^[-–—\s]+|[-–—\s]+$/g, ''))
    .filter((item) => item.length >= 2 && item.length <= 24)
    .filter((item) => !COLOR_NON_VALUE_HINTS.some((hint) => normalizeKey(` ${item} `).includes(hint)));
  return [...new Set(pieces)];
}

/** 值里含「темно-синий」这类复合词时，抽出其中的基础色 */
function colorKeywordOf(value: string): string | null {
  const key = normalizeKey(value);
  for (const [alias, canonical] of Object.entries(COLOR_SYNONYMS)) {
    if (alias.length >= 3 && key.includes(normalizeKey(alias))) {
      return canonical;
    }
  }
  return null;
}

/**
 * 解析出 WB 能接受的颜色值。
 * 目录非空时只允许目录内的值——WB 颜色是枚举，传自由文本必然报 `Недопустимое значение цвета`。
 */
export function resolveWbColorValue(
  candidates: string[],
  directory?: WbDirectoryItem[],
  options?: { required?: boolean },
): string | null {
  const hasDirectory = Boolean(directory?.length);
  const pieces = candidates.flatMap((item) => sanitizeWbColorValue(item));
  for (const piece of pieces) {
    const synonym = COLOR_SYNONYMS[normalizeKey(piece)] || colorKeywordOf(piece);
    const matched = matchDirectory(piece, directory) || matchDirectory(synonym, directory);
    if (matched) {
      return matched;
    }
    if (!hasDirectory) {
      return synonym || piece;
    }
  }
  if (!options?.required) {
    return null;
  }
  for (const fallback of COLOR_FALLBACKS) {
    const matched = matchDirectory(fallback, directory);
    if (matched) {
      return matched;
    }
  }
  // 目录没拉到时用最常见的兜底色，避免因「缺少 Цвет」整卡失败
  return hasDirectory ? null : COLOR_FALLBACKS[0];
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
  if (!key) {
    return null;
  }
  const exact = items.find((item) => normalizeKey(item.name) === key);
  if (exact) {
    return exact.name;
  }
  // 模糊匹配限定在 4 字符以上并按整词比对：否则「хаки」会把任意含该子串的长文本判成命中
  const fuzzy = items.find((item) => {
    const name = normalizeKey(item.name);
    if (name.length < 4 || key.length < 4) {
      return false;
    }
    return includesWord(name, key) || includesWord(key, name);
  });
  return fuzzy?.name || null;
}

function includesWord(haystack: string, needle: string): boolean {
  const index = haystack.indexOf(needle);
  if (index < 0) {
    return false;
  }
  const before = index === 0 ? '' : haystack[index - 1];
  const after = haystack[index + needle.length] || '';
  return !/[a-zа-я0-9]/i.test(before) && !/[a-zа-я0-9]/i.test(after);
}

function matchVat(value: string | number | string[] | null, items?: string[]): string | null {
  if (!items?.length) {
    return null;
  }
  const raw = value == null ? '' : Array.isArray(value) ? value[0] : String(value);
  const key = normalizeKey(raw);
  return items.find((item) => normalizeKey(item) === key) || items.find((item) => /0|без|не облаг/i.test(item)) || items[0];
}
