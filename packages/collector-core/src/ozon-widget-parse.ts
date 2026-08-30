import type { ProductSpec } from '@aiecom/shared';

export function widgetName(key: string): string {
  return String(key || '').split('-')[0];
}

export function parseWidgetValue(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function rsText(arr: unknown, depth = 0): string {
  if (depth > 8 || arr == null) {
    return '';
  }
  if (typeof arr === 'string' || typeof arr === 'number') {
    const text = String(arr).replace(/\s+/g, ' ').trim();
    return text === '[object Object]' ? '' : text;
  }
  if (Array.isArray(arr)) {
    return arr
      .map((item) => rsText(item, depth + 1))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (typeof arr !== 'object') {
    return '';
  }
  const rec = arr as Record<string, unknown>;
  for (const key of ['text', 'content', 'textRs', 'contentRS', 'valueRs', 'values', 'title', 'value']) {
    if (rec[key] == null) {
      continue;
    }
    const found = rsText(rec[key], depth + 1);
    if (found) {
      return found;
    }
  }
  return '';
}

export function widgetsNamed(page: unknown, name: string): Record<string, unknown>[] {
  const rec = page && typeof page === 'object' ? (page as Record<string, unknown>) : null;
  const ws = rec?.widgetStates;
  if (!ws || typeof ws !== 'object' || Array.isArray(ws)) {
    return [];
  }
  const states = ws as Record<string, unknown>;
  return Object.keys(states)
    .filter((key) => widgetName(key) === name)
    .map((key) => parseWidgetValue(states[key]))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function flattenCharRows(raw: unknown, depth = 0): unknown[] {
  if (depth > 6 || raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => flattenCharRows(item, depth + 1));
  }
  if (typeof raw !== 'object') {
    return [];
  }
  const rec = raw as Record<string, unknown>;
  const nested = [rec.long, rec.short, rec.all, rec.characteristics, rec.groups, rec.sections, rec.items, rec.blocks]
    .filter(Boolean)
    .flatMap((item) => flattenCharRows(item, depth + 1));
  if (rec.title || rec.name || rec.key || rec.titleRs || rec.values || rec.value || rec.contentRS) {
    return [rec, ...nested];
  }
  return nested;
}

export function parseCharacteristicRows(widget: Record<string, unknown> | null): ProductSpec[] {
  if (!widget) {
    return [];
  }
  const rows = flattenCharRows(
    widget.characteristics ?? widget.shortCharacteristics ?? widget.characteristicsList ?? widget.long ?? widget.short,
  );
  const specs: ProductSpec[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const title =
      rsText(rec.title) ||
      rsText(rec.titleRs) ||
      (typeof rec.name === 'string' ? rec.name : '') ||
      (typeof rec.key === 'string' ? rec.key : '');
    const value = rsText(rec.values ?? rec.contentRS ?? rec.valueRs ?? rec.value);
    const name = title.replace(/\s+/g, ' ').trim();
    const text = value.replace(/\s+/g, ' ').trim();
    if (!name || !text || name.length > 80 || text.length > 800) {
      continue;
    }
    specs.push({ name, value: text });
  }
  return specs;
}

export function parseLabeledDescriptionSpecs(text: string): ProductSpec[] {
  const source = String(text || '').replace(/\\n/g, '\n');
  if (!source.trim()) {
    return [];
  }
  const found: Array<{ name: string; start: number; valueStart: number }> = [];
  const re = /(?:^|[\n;；])\s*([A-Za-zА-ЯЁа-яё][^:\n]{0,40}?)\s*[:：][^\S\n]*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1].trim();
    if (name && name.length <= 48) {
      found.push({ name, start: match.index, valueStart: match.index + match[0].length });
    }
  }
  const specs: ProductSpec[] = [];
  for (let i = 0; i < found.length; i += 1) {
    const value = source
      .slice(found[i].valueStart, found[i + 1] ? found[i + 1].start : source.length)
      .replace(/\s+/g, ' ')
      .trim();
    if (!value || /https?:|class=|widget/i.test(found[i].name + value)) {
      continue;
    }
    specs.push({ name: found[i].name, value: value.slice(0, 800) });
  }
  return specs;
}

export function parseShortCharacteristics(page: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const widget of [
    ...widgetsNamed(page, 'webShortCharacteristics'),
    ...widgetsNamed(page, 'webCharacteristics'),
  ]) {
    for (const row of parseCharacteristicRows(widget)) {
      if (!out[row.name]) {
        out[row.name] = row.value;
      }
    }
  }
  return out;
}

function normCharName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePhysicalSizeValue(raw: string): boolean {
  const value = String(raw || '');
  return /[xх×*]/.test(value) && (value.match(/\d+/g) || []).length >= 2;
}

function shouldTreatAsCm(nums: number[], source: string, height: number): boolean {
  const blob = source.toLowerCase();
  if (/см|cm/.test(blob) && !/мм|mm/.test(blob)) {
    return true;
  }
  if (/мм|mm/.test(blob)) {
    return false;
  }
  const max = Math.max(0, ...nums.filter((item) => item > 0));
  return !height && max >= 40 && max <= 400;
}

function parseSizePairsMm(raw: string): Array<{ depth: number; width: number; height: number }> {
  const source = String(raw || '').replace(/,/g, '.');
  const pairs: Array<{ depth: number; width: number; height: number }> = [];
  const re =
    /(\d+(?:\.\d+)?)\s*(см|mm|мм|cm)?\s*[xх×*]\s*(\d+(?:\.\d+)?)\s*(см|mm|мм|cm)?(?:\s*[xх×*]\s*(\d+(?:\.\d+)?)\s*(см|mm|мм|cm)?)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const rawDepth = Number(match[1]);
    const rawWidth = Number(match[3]);
    const rawHeight = Number(match[5] || 0);
    if (![rawDepth, rawWidth].every((item) => Number.isFinite(item) && item > 0)) {
      continue;
    }
    const unitBlob = `${match[2] || ''} ${match[4] || ''} ${match[6] || ''} ${source}`;
    const asCm = shouldTreatAsCm([rawDepth, rawWidth, rawHeight], unitBlob, rawHeight);
    const toMm = (value: number) => (asCm ? value * 10 : value);
    const depth = toMm(rawDepth);
    const width = toMm(rawWidth);
    const height = rawHeight > 0 ? toMm(rawHeight) : 0;
    if (depth > 0 && width > 0 && depth < 5000 && width < 5000 && height < 5000) {
      pairs.push({ depth, width, height });
    }
  }
  return pairs;
}

function parseDimensionMm(raw: string): { depth: number; width: number; height: number } | null {
  const triples = parseSizePairsMm(raw).filter((item) => item.height > 0);
  if (triples.length) {
    return triples.sort((a, b) => b.depth * b.width * b.height - a.depth * a.width * a.height)[0];
  }
  const pairs = parseSizePairsMm(raw);
  return pairs.sort((a, b) => b.depth * b.width - a.depth * a.width)[0] || null;
}

function parseWeightGrams(raw: string, name = ''): number {
  const context = `${name} ${raw}`;
  const match = String(raw || '')
    .replace(',', '.')
    .match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  if (/кг|kg/i.test(context)) {
    return Math.round(num * 1000);
  }
  if (/г(?!р)|g\b|gram/i.test(context)) {
    return Math.round(num);
  }
  if (num > 0 && num < 80 && num % 1 !== 0) {
    return Math.round(num * 1000);
  }
  return Math.round(num);
}

const SIZE_NAME_RE = /^(размер(?!а производителя)|габарит|длина|ширина|высота|глубина)/;
const WEIGHT_NAME_RE =
  /^(вес(?![а-яё])|вес товара|вес брутто|вес упаков|вес в упаков|вес нетто|вес,|масса(?![а-яё])|weight)/;
const SKIP_SIZE_RE = /экран|диагональ|ssd|памят|кольц|ring|длина в мм/;
const SKIP_WEIGHT_RE = /весь ozon|весы(?:\s|$)/;

function toMmFromNamed(value: string, blob: string): number {
  const num = Number(String(value).replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return /см|cm/i.test(blob) && !/мм|mm/i.test(blob) ? num * 10 : num;
}

export function warehouseSpecsFromCharacteristics(specs: ProductSpec[]): ProductSpec[] {
  const extra: ProductSpec[] = [];
  const hasNamed =
    specs.some((item) => item.name === 'Длина, мм') &&
    specs.some((item) => item.name === 'Ширина, мм') &&
    specs.some((item) => item.name === 'Высота, мм');
  if (!hasNamed) {
    const named = { length: '', width: '', height: '' };
    for (const spec of specs) {
      const key = normCharName(spec.name);
      if (SKIP_SIZE_RE.test(key)) {
        continue;
      }
      if (/длина/.test(key) && !named.length) {
        named.length = spec.value;
      } else if (/ширина/.test(key) && !named.width) {
        named.width = spec.value;
      } else if (/высота|толщина/.test(key) && !named.height) {
        named.height = spec.value;
      }
    }
    if (named.length && named.width && named.height) {
      const blob = `${named.length} ${named.width} ${named.height}`;
      const mm = [named.length, named.width, named.height].map((item) => toMmFromNamed(item, blob));
      if (mm.every((item) => item > 0 && item < 5000)) {
        extra.push(
          { name: 'Длина, мм', value: String(Math.round(mm[0])) },
          { name: 'Ширина, мм', value: String(Math.round(mm[1])) },
          { name: 'Высота, мм', value: String(Math.round(mm[2])) },
        );
      }
    }
    if (!extra.length) {
      for (const spec of specs) {
        const key = normCharName(spec.name);
        if (SKIP_SIZE_RE.test(key) || !SIZE_NAME_RE.test(key) || !looksLikePhysicalSizeValue(spec.value)) {
          continue;
        }
        const parsed = parseDimensionMm(spec.value);
        if (!parsed || parsed.depth <= 0 || parsed.width <= 0) {
          continue;
        }
        const thick = toMmFromNamed(named.height, named.height);
        const defaultHeight = Math.max(parsed.depth, parsed.width) >= 400 ? 20 : 0;
        const height = parsed.height > 0 ? parsed.height : thick || defaultHeight;
        if (height <= 0 || height >= 5000) {
          continue;
        }
        extra.push(
          {
            name: 'Длина, мм',
            value: String(Math.round(parsed.height > 0 ? parsed.depth : Math.max(parsed.depth, parsed.width))),
          },
          {
            name: 'Ширина, мм',
            value: String(Math.round(parsed.height > 0 ? parsed.width : Math.min(parsed.depth, parsed.width))),
          },
          { name: 'Высота, мм', value: String(Math.max(1, Math.round(height))) },
        );
        break;
      }
    }
  }
  if (!specs.some((item) => item.name === 'Вес товара, г')) {
    for (const spec of specs) {
      const key = normCharName(spec.name);
      if (SKIP_WEIGHT_RE.test(key) || !WEIGHT_NAME_RE.test(key)) {
        continue;
      }
      const grams = parseWeightGrams(spec.value, spec.name);
      if (grams > 0 && grams < 100000) {
        extra.push({ name: 'Вес товара, г', value: String(grams) });
        break;
      }
    }
  }
  return extra;
}

export function parseOzonWidgetPage(page: unknown): {
  specs: ProductSpec[];
  warehouse: ProductSpec[];
  title: string;
  sellerName: string;
  brand: string;
  images: string[];
  sku: string;
} {
  const specs: ProductSpec[] = [];
  const seen = new Set<string>();
  const push = (name: string, value: string) => {
    const n = name.replace(/\s+/g, ' ').trim();
    const v = value.replace(/\s+/g, ' ').trim();
    if (!n || !v) {
      return;
    }
    const key = `${n}=${v}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    specs.push({ name: n, value: v });
  };
  for (const row of Object.entries(parseShortCharacteristics(page))) {
    push(row[0], row[1]);
  }
  for (const widget of widgetsNamed(page, 'webDescription')) {
    const raw = widget.richAnnotation ?? widget.text ?? widget.html ?? widget.description;
    const text = typeof raw === 'string' ? raw : rsText(raw);
    for (const row of parseLabeledDescriptionSpecs(text)) {
      push(row.name, row.value);
    }
  }
  const heading = widgetsNamed(page, 'webProductHeading')[0];
  const title = rsText(heading?.title ?? heading?.name ?? heading?.text);
  const seller = widgetsNamed(page, 'webCurrentSeller')[0];
  const sellerName = rsText(
    seller?.name ??
      (seller?.sellerCell as Record<string, unknown> | undefined)?.centerBlock ??
      seller?.sellerName,
  );
  const brandWidget = widgetsNamed(page, 'webBrand')[0];
  const brand = rsText(brandWidget?.name ?? brandWidget?.title ?? brandWidget?.brandName);
  if (brand) {
    push('Бренд', brand);
  }
  if (sellerName) {
    push('Продавец', sellerName);
  }
  const images: string[] = [];
  for (const gallery of widgetsNamed(page, 'webGallery')) {
    if (typeof gallery.coverImage === 'string') {
      images.push(gallery.coverImage);
    }
    const list = Array.isArray(gallery.images) ? gallery.images : [];
    for (const item of list) {
      if (typeof item === 'string') {
        images.push(item);
      } else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (typeof rec.src === 'string') {
          images.push(rec.src);
        } else if (typeof rec.url === 'string') {
          images.push(rec.url);
        }
      }
    }
  }
  const sticky = widgetsNamed(page, 'webStickyProducts')[0];
  const sku = String(sticky?.sku ?? '').match(/(\d{6,})/)?.[1] || '';
  return {
    specs,
    warehouse: warehouseSpecsFromCharacteristics(specs),
    title,
    sellerName,
    brand,
    images,
    sku,
  };
}
