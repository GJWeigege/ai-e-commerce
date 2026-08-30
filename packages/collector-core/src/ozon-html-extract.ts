import {
  alignSkuOptions,
  dedupeVariants,
  inferWeightOption,
  isSpecAspectName,
  ozonListingSlugFamily,
  optionsForSku,
  ProductSkuOption,
  ProductSpec,
  ProductVariant,
  ProductVariantValue,
  StandardProduct,
} from '@aiecom/shared';

import {
  parseLabeledDescriptionSpecs,
  parseOzonWidgetPage,
  warehouseSpecsFromCharacteristics,
} from './ozon-widget-parse';

const IMAGE_SIZE_DIR = /\/(?:wc|wcs|c)\d+\//i;

function unescapeHtmlBlob(html: string): string {
  return html.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
}

/** Ozon 会换图床域名（ozone.ru → ozonstatic.cn），只认固定白名单会把整图集丢掉 */
export function isOzonMediaHost(raw: string): boolean {
  let href = String(raw || '').trim();
  if (href.startsWith('//')) {
    href = `https:${href}`;
  }
  try {
    const host = new URL(href).hostname.toLowerCase();
    if (/(?:^|\.)(ozone\.ru|ozonusercontent\.com)$/i.test(host)) {
      return true;
    }
    if (/(?:^|\.)ozonstatic\.[a-z]+$/i.test(host)) {
      return true;
    }
    return /ozon/i.test(host) && /^(ir(?:-\d+)?|cdn\d*)\./i.test(host);
  } catch {
    return /ozone\.ru|ozonusercontent\.com|ozonstatic\./i.test(raw);
  }
}

export function parseOzonPrice(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  const text = String(raw ?? '').trim();
  if (!text) {
    return 0;
  }
  const compact = text.replace(/[^\d,.\s]/g, '').replace(/\s+/g, '').trim();
  if (!compact) {
    return 0;
  }
  if (/^\d+,\d{1,2}$/.test(compact)) {
    return Number(compact.replace(',', '.')) || 0;
  }
  if (/^\d+\.\d{1,2}$/.test(compact)) {
    return Number(compact) || 0;
  }
  return Number(compact.replace(/[.,]/g, '')) || 0;
}

export function normalizeOzonImageUrl(raw: string): string | null {
  if (!raw) {
    return null;
  }
  let url = raw
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
  if (url.startsWith('//')) {
    url = `https:${url}`;
  }
  if (url.startsWith('/s3/')) {
    url = `https://ir.ozone.ru${url}`;
  }
  if (!/^https?:\/\//i.test(url) || !isOzonMediaHost(url)) {
    return null;
  }
  if (/\.(svg|gif)(\?|$)/i.test(url) || /favicon|sprite|logo|pixel|1x1|avatar/i.test(url)) {
    return null;
  }
  url = url.replace(/\/(?:wc|wcs)(?:18|28|50|75|100|140|160|180|200|240|250|300|400)\//i, '/wc1200/');
  return url.split('#')[0];
}

export function isProductGalleryImage(raw: string): boolean {
  const url = normalizeOzonImageUrl(raw);
  if (!url) {
    return false;
  }
  if (/\/cms\/|\/graphics\/|\/icons?\/|\/static\/|\/promo\/|\/bonus\/|\/marketing-api\/|\/banners?\/|searchteam-cdn/i.test(url)) {
    return false;
  }
  if (/(?:^|[/-])(?:logo|icon|badge|banner|sprite|avatar|favicon|payment|card-icon|flame)(?:[/-]|\.|$)/i.test(url)) {
    return false;
  }
  return /\/s3\/(?:multimedia|rp-photo)/i.test(url) || /\/multimedia(?:-\w+)?\//i.test(url);
}

function mediaKey(url: string): string {
  const match =
    url.match(/multimedia[^/]*\/(?:(?:wc|wcs|c)\d+\/)?([^/?#]+)/i) ||
    url.match(/rp-photo[^/]*\/(?:(?:wc|wcs|c)\d+\/)?([^/?#]+)/i);
  return match?.[1] ?? url.split('?')[0];
}

function imageRank(url: string): number {
  if (/\/wc(?:1200|1500|2000|2500)\//i.test(url)) {
    return 4;
  }
  if (/\/wc1000\//i.test(url)) {
    return 3;
  }
  if (/\/(?:multimedia|rp-photo)/i.test(url) && !IMAGE_SIZE_DIR.test(url)) {
    return 5;
  }
  return 1;
}

export function uniqueOzonImages(urls: Array<string | undefined | null>, limit = 30): string[] {
  const best = new Map<string, { url: string; rank: number }>();
  for (const item of urls) {
    const url = item && isProductGalleryImage(item) ? normalizeOzonImageUrl(item) : null;
    if (!url) {
      continue;
    }
    const key = mediaKey(url);
    const rank = imageRank(url);
    const current = best.get(key);
    if (!current || rank > current.rank) {
      best.set(key, { url, rank });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((item) => item.url);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObjectAt(source: string, braceIndex: number): unknown | null {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = braceIndex; i < Math.min(source.length, braceIndex + 8_000_000); i += 1) {
    const ch = source[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return parseJsonSafe(source.slice(braceIndex, i + 1));
      }
    }
  }
  return null;
}

function collectJsonTrees(html: string): unknown[] {
  const trees: unknown[] = [];
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const script of scripts) {
    const body = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    if (!body) {
      continue;
    }
    const parsed = parseJsonSafe(body);
    if (parsed) {
      trees.push(parsed);
    }
  }
  const marker = html.indexOf('"widgetStates"');
  if (marker >= 0) {
    const brace = html.indexOf('{', marker);
    if (brace >= 0) {
      const parsed = extractJsonObjectAt(html, brace);
      if (parsed) {
        trees.push(parsed);
      }
    }
  }
  const stateRe = /data-state=(["'])([\s\S]*?)\1/gi;
  let stateMatch: RegExpExecArray | null;
  while ((stateMatch = stateRe.exec(html)) !== null) {
    const decoded = stateMatch[2]
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'");
    const parsed = parseJsonSafe(decoded);
    if (parsed) {
      trees.push(parsed);
    }
  }
  return trees;
}

function isRecommendWidgetKey(key: string): boolean {
  return /tileGrid|skuGrid|recommend|similar|alsoBuy|boughtTogether|webList|collection|related|catalogMenu|tapTags|horizontalMenu|bigPromo/i.test(
    String(key || ''),
  );
}

function walkJson(node: unknown, visit: (obj: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 18 || node == null) {
    return;
  }
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 8) {
      const parsed = parseJsonSafe(trimmed);
      if (parsed) {
        walkJson(parsed, visit, depth + 1);
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walkJson(item, visit, depth + 1));
    return;
  }
  const rec = asRecord(node);
  if (!rec) {
    return;
  }
  visit(rec);
  Object.entries(rec).forEach(([key, value]) => {
    if (isRecommendWidgetKey(key)) {
      return;
    }
    walkJson(value, visit, depth + 1);
  });
}

function parseJsonLdProducts(html: string): Record<string, unknown>[] {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const products: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    const parsed = parseJsonSafe(json);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const rec = asRecord(item);
      if (rec && (rec['@type'] === 'Product' || rec['@type'] === 'BreadcrumbList' || rec.name)) {
        products.push(rec);
      }
    }
  }
  return products;
}

function collectJsonLdImages(product: Record<string, unknown>): string[] {
  const image = product.image;
  if (typeof image === 'string') {
    return [image];
  }
  if (Array.isArray(image)) {
    return image.flatMap((item) => {
      if (typeof item === 'string') {
        return [item];
      }
      const rec = asRecord(item);
      return typeof rec?.url === 'string' ? [rec.url] : [];
    });
  }
  const rec = asRecord(image);
  return typeof rec?.url === 'string' ? [rec.url] : [];
}

function collectJsonLdSpecs(product: Record<string, unknown>): ProductSpec[] {
  const raw = product.additionalProperty;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const specs: ProductSpec[] = [];
  for (const item of items) {
    const rec = asRecord(item);
    const name = typeof rec?.name === 'string' ? rec.name.trim() : '';
    const value = rec?.value;
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (name && text) {
      specs.push({ name, value: text });
    }
  }
  return specs;
}

function collectDlSpecs(html: string): ProductSpec[] {
  const specs: ProductSpec[] = [];
  const re = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const name = stripTags(match[1]);
    const value = stripTags(match[2]);
    if (name && value && name.length <= 80 && value.length <= 500) {
      specs.push({ name, value });
    }
  }
  return specs;
}

const WAREHOUSE_SPEC_NAMES = new Set(['Длина, мм', 'Ширина, мм', 'Высота, мм', 'Вес товара, г']);

function mergeSpecs(groups: ProductSpec[][]): ProductSpec[] {
  const seen = new Set<string>();
  const out: ProductSpec[] = [];
  for (const group of groups) {
    for (const spec of group) {
      const key = WAREHOUSE_SPEC_NAMES.has(spec.name) ? spec.name : `${spec.name}=${spec.value}`;
      if (seen.has(key) || spec.name === '商品描述' || spec.name === '[object Object]') {
        continue;
      }
      seen.add(key);
      out.push(spec);
      if (out.length >= 60) {
        return out;
      }
    }
  }
  return out;
}

function asSku(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  const path = text.split('?')[0].split('#')[0];
  const fromSlug = path.match(/-(\d{6,})\/?$/);
  if (fromSlug) {
    return fromSlug[1];
  }
  const nums = path.match(/(\d{6,})/g);
  return nums ? nums[nums.length - 1] : '';
}

function offerPrice(product: Record<string, unknown>): number {
  const offers = product.offers;
  const offer = Array.isArray(offers) ? asRecord(offers[0]) : asRecord(offers);
  return parseOzonPrice(offer?.price);
}

function ratingValue(product: Record<string, unknown>): number | undefined {
  const rating = asRecord(product.aggregateRating)?.ratingValue;
  const parsed = parseOzonPrice(rating);
  return parsed > 0 && parsed <= 5 ? parsed : typeof rating === 'number' ? rating : undefined;
}

function reviewCountOf(product: Record<string, unknown>): number {
  const rating = asRecord(product.aggregateRating);
  return Math.round(parseOzonPrice(rating?.reviewCount || rating?.ratingCount));
}

function isTinyOrBadgeImage(rec: Record<string, unknown>): boolean {
  const type = String(rec.type ?? rec.kind ?? rec.role ?? '');
  if (/logo|icon|badge|banner|sprite|payment/i.test(type)) {
    return true;
  }
  const width = Number(rec.width ?? rec.w);
  const height = Number(rec.height ?? rec.h);
  return Number.isFinite(width) && Number.isFinite(height) && Math.max(width, height) > 0 && Math.max(width, height) < 200;
}

function imageUrlsFromUnknown(raw: unknown, depth = 0): string[] {
  if (depth > 5 || raw == null) {
    return [];
  }
  if (typeof raw === 'string') {
    if (raw.startsWith('/s3/')) {
      return [`https://ir.ozone.ru${raw}`];
    }
    return raw.startsWith('http') || raw.startsWith('//') ? [raw] : [];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => imageUrlsFromUnknown(item, depth + 1));
  }
  const rec = asRecord(raw);
  if (!rec || isTinyOrBadgeImage(rec)) {
    return [];
  }
  const keys = [
    'original',
    'src',
    'url',
    'image',
    'coverImage',
    'coverImageUrl',
    'previewUrl',
    'srcBig',
    'picture',
    'file_name',
    'link',
  ];
  return keys.flatMap((key) => imageUrlsFromUnknown(rec[key], depth + 1));
}

function isPdpGalleryWidgetKey(key: string): boolean {
  if (isRecommendWidgetKey(key)) {
    return false;
  }
  const name = String(key || '').split('-')[0];
  return /^(webGallery|galleryMobile|pdpGallery|webProductGallery|webPhotoGallery|productGallery)$/i.test(name);
}

function isTrustedDimWidgetKey(key: string): boolean {
  return /webSale|webDelivery|webCharacteristics|webShortCharacteristics|webProductMainWidget|webDetailSKU|webPdp|webPrice/i.test(
    String(key || ''),
  );
}

function objectSku(obj: Record<string, unknown>): string {
  const value = obj.sku ?? obj.skuId ?? obj.productId;
  const match = String(value ?? '').match(/(\d{6,})/);
  return match ? match[1] : '';
}

function collectImagesFromGalleryWidget(raw: unknown): string[] {
  const rec = asRecord(raw);
  if (!rec || rec.tileImage || rec.mainState) {
    return [];
  }
  const urls = [...imageUrlsFromUnknown(rec.coverImage), ...imageUrlsFromUnknown(rec.coverImageUrl)];
  for (const key of ['images', 'media', 'photos', 'gallery']) {
    const items = rec[key];
    if (!Array.isArray(items) || items.length === 0) {
      continue;
    }
    items.forEach((item) => {
      if (typeof item === 'string') {
        urls.push(item);
        return;
      }
      const row = asRecord(item);
      if (!row || isTinyOrBadgeImage(row)) {
        return;
      }
      const kind = String(row.type ?? row.kind ?? row.role ?? row.mediaType ?? '');
      if (kind && /video|youtube|mp4/i.test(kind) && !/image|photo|picture/i.test(kind)) {
        return;
      }
      urls.push(...imageUrlsFromUnknown(row));
    });
  }
  return urls;
}

function collectGalleryImagesFromTree(trees: unknown[], html = '', skuId = ''): string[] {
  const urls: string[] = [];
  for (const tree of trees) {
    const rec = asRecord(tree);
    const states = asRecord(rec?.widgetStates);
    if (!states) {
      continue;
    }
    for (const [key, value] of Object.entries(states)) {
      if (isRecommendWidgetKey(key)) {
        continue;
      }
      const parsed = typeof value === 'string' ? parseJsonSafe(value) : value;
      if (!isPdpGalleryWidgetKey(key)) {
        continue;
      }
      urls.push(...collectImagesFromGalleryWidget(parsed));
    }
  }
  const tagRe = /<(?:div|section)[^>]*(?:data-widget="[^"]*webGallery[^"]*"|id="[^"]*webGallery[^"]*")[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const state = tagMatch[0].match(/data-state=(["'])([\s\S]*?)\1/i);
    if (!state) {
      continue;
    }
    const decoded = state[2]
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'");
    urls.push(...collectImagesFromGalleryWidget(parseJsonSafe(decoded)));
  }
  return urls;
}

function collectImagesFromWebGalleryHtml(html: string): string[] {
  const urls: string[] = [];
  const startRe = /data-widget="[^"]*webGallery[^"]*"/gi;
  let match: RegExpExecArray | null;
  while ((match = startRe.exec(html)) !== null) {
    const slice = html.slice(match.index, match.index + 8000);
    const attrRe = /(?:src|data-src|data-original|data-lazy|srcset)=["']([^"']+)["']/gi;
    let attr: RegExpExecArray | null;
    while ((attr = attrRe.exec(slice)) !== null) {
      attr[1].split(',').forEach((part) => urls.push(part.trim().split(/\s+/)[0]));
    }
  }
  return urls;
}

function collectVideosFromTree(trees: unknown[]): string[] {
  const urls: string[] = [];
  for (const tree of trees) {
    walkJson(tree, (obj) => {
      if (typeof obj.videoUrl === 'string') {
        urls.push(obj.videoUrl);
      }
      if (typeof obj.mp4Url === 'string') {
        urls.push(obj.mp4Url);
      }
      if (obj.isVideo === true && typeof obj.src === 'string') {
        urls.push(obj.src);
      }
    });
  }
  return [...new Set(urls)].filter((url) => /^https?:\/\//i.test(url)).slice(0, 8);
}

export function cleanAspectChipText(raw: unknown): string {
  let text = String(raw ?? '')
    .replace(/выгода\s*\d+\s*%/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/\s+[\d,.]+ *[₽¥].*$/u, '').trim();
  text = text.replace(/\s*\/\s*100.*$/i, '').trim();
  const leadNum = text.match(/^(\d{2,5})(?:\s|$)/);
  if (leadNum) {
    return leadNum[1];
  }
  const token = text.split('\n')[0].trim().split(' ')[0] || '';
  if (
    !token ||
    token.length > 80 ||
    /^https?:/i.test(token) ||
    /[₽¥]/u.test(token) ||
    /выгода/i.test(token) ||
    /^\d+[,.]\d+$/.test(token)
  ) {
    return '';
  }
  return token;
}

function textFromUnknown(raw: unknown, depth = 0): string {
  if (depth > 5 || raw == null) {
    return '';
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const text = String(raw).replace(/\s+/g, ' ').trim();
    return text === '[object Object]' ? '' : text;
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => textFromUnknown(item, depth + 1))
      .filter(Boolean)
      .join(', ');
  }
  const rec = asRecord(raw);
  if (!rec) {
    return '';
  }
  for (const key of [
    'text',
    'content',
    'textRs',
    'textAtom',
    'contentRS',
    'valueRs',
    'titleRs',
    'title',
    'value',
    'name',
    'label',
    'key',
    'caption',
  ]) {
    const found = textFromUnknown(rec[key], depth + 1);
    if (found) {
      return found;
    }
  }
  return '';
}

function aspectChipValue(rec: Record<string, unknown>): string {
  const data = asRecord(rec.data);
  const content = asRecord(data?.content) || asRecord(rec.content);
  const title = asRecord(rec.title) || asRecord(data?.title);
  const parts = [
    rec.key,
    rec.value,
    rec.text,
    rec.searchableText,
    rec.name,
    rec.label,
    rec.subtitle,
    rec.caption,
    rec.ariaLabel,
    rec['aria-label'],
    rec.alt,
    rec.color,
    rec.colorName,
    rec.hint,
    rec.primaryText,
    rec.secondaryText,
    data?.text,
    data?.value,
    data?.name,
    data?.label,
    data?.subtitle,
    data?.key,
    data?.ariaLabel,
    data?.alt,
    data?.color,
    content?.text,
    title?.text,
    textFromUnknown(rec.title),
    textFromUnknown(data?.title),
    textFromUnknown(rec.badge),
  ];
  const cleaned = parts.map((item) => cleanAspectChipText(item)).filter(Boolean);
  const numeric = cleaned.find((item) => /^\d{2,5}$/.test(item));
  if (numeric) {
    return numeric;
  }
  const joined = cleanAspectChipText(parts.filter((item) => item != null && item !== '').map(String).join(' '));
  return joined || cleaned[0] || '';
}

function extractProductHref(raw: unknown, depth = 0): string {
  if (depth > 5 || raw == null) {
    return '';
  }
  if (typeof raw === 'string') {
    const match = raw.match(/https?:\/\/[^"' \s<>]*ozon\.ru\/product\/[^"'?\s<>]+/i) || raw.match(/\/product\/[a-z0-9\-._%]+/i);
    return match ? match[0] : '';
  }
  const rec = asRecord(raw);
  if (!rec) {
    return '';
  }
  for (const key of [
    'link',
    'href',
    'url',
    'deepLink',
    'relativeUrl',
    'canonicalUrl',
    'pathname',
    'action',
    'clickUrl',
    'targetUrl',
    'skuUrl',
  ]) {
    const found = extractProductHref(rec[key], depth + 1);
    if (found) {
      return found;
    }
  }
  return extractProductHref(rec.data, depth + 1);
}

function aspectSwatchImages(rec: Record<string, unknown>): string[] {
  const data = asRecord(rec.data);
  const raw = [
    rec.image,
    rec.preview,
    rec.src,
    rec.picture,
    rec.coverImage,
    data?.image,
    data?.preview,
    data?.src,
    data?.picture,
  ];
  const urls: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const url = normalizeOzonImageUrl(item);
      if (url) {
        urls.push(url);
      }
      continue;
    }
    const nested = asRecord(item);
    if (typeof nested?.src === 'string' || typeof nested?.url === 'string' || typeof nested?.original === 'string') {
      const url = normalizeOzonImageUrl(String(nested.original || nested.src || nested.url));
      if (url) {
        urls.push(url);
      }
    }
  }
  return [...new Set(urls)];
}

function variantValueFrom(rec: Record<string, unknown>, pageUrl: string): ProductVariantValue | null {
  const data = asRecord(rec.data);
  const link =
    extractProductHref(rec.link) ||
    extractProductHref(rec.href) ||
    extractProductHref(rec.url) ||
    extractProductHref(rec.deepLink) ||
    extractProductHref(rec.action) ||
    extractProductHref(data);
  const sourceUrl = link
    ? link.startsWith('http')
      ? link.split('?')[0]
      : `https://www.ozon.ru${link.startsWith('/') ? link : `/${link}`}`.split('?')[0]
    : undefined;
  const skuId = asSku(sourceUrl) || asSku(rec.sku ?? rec.skuId ?? rec.skuIdStr ?? data?.sku ?? data?.skuId ?? '');
  const swatches = aspectSwatchImages(rec);
  let compact = aspectChipValue(rec);
  if (!compact) {
    compact = inferWeightOption(String(rec.searchableText ?? rec.title ?? ''), sourceUrl || '') || '';
  }
  if (!compact && (skuId || swatches.length)) {
    compact =
      cleanAspectChipText(rec.ariaLabel ?? rec['aria-label'] ?? rec.alt ?? data?.alt ?? '') ||
      (skuId ? `вариант ${skuId}` : '');
  }
  if (!compact) {
    return null;
  }
  return {
    value: compact,
    selected: Boolean(rec.isSelected ?? rec.selected ?? rec.active ?? rec.checked ?? data?.active),
    skuId: skuId || undefined,
    sourceUrl: sourceUrl || (skuId ? `https://www.ozon.ru/product/${skuId}/` : undefined),
    price: parseOzonPrice(rec.price ?? rec.cardPrice ?? data?.price) || undefined,
    imageUrls: swatches.length ? swatches : undefined,
  };
}

function aspectNameOf(rec: Record<string, unknown>): string {
  const data = asRecord(rec.data);
  return String(rec.name ?? rec.title ?? rec.key ?? rec.aspectName ?? data?.title ?? data?.name ?? '')
    .replace(/\s+/g, ' ')
    .split(':')[0]
    .replace(/:$/, '')
    .trim();
}

function ingestAspectValues(
  map: Map<string, ProductVariant>,
  rec: Record<string, unknown>,
  pageUrl: string,
  fromAspectList: boolean,
) {
  const name = aspectNameOf(rec);
  const valuesRaw =
    rec.aspectValues ??
    rec.values ??
    rec.items ??
    rec.variants ??
    rec.options ??
    rec.buttons ??
    rec.pills ??
    rec.rs ??
    rec.cs ??
    rec.valueList;
  if (!name || !isSpecAspectName(name) || !Array.isArray(valuesRaw)) {
    return;
  }
  const records = valuesRaw
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const values = records
    .map((item) => variantValueFrom(item, pageUrl))
    .filter((item): item is ProductVariantValue => Boolean(item));
  if (values.length < 2) {
    return;
  }
  const selectable = values.some((item) => Boolean(item.sourceUrl || item.skuId || item.selected));
  if (!fromAspectList && !selectable) {
    return;
  }
  const current = map.get(name) ?? { name, values: [] };
  const seen = new Set(current.values.map((item) => item.value));
  for (const value of values) {
    if (seen.has(value.value)) {
      continue;
    }
    seen.add(value.value);
    current.values.push(value);
  }
  map.set(name, current);
}

function collectVariantsFromTree(trees: unknown[], pageUrl: string): ProductVariant[] {
  const map = new Map<string, ProductVariant>();
  for (const tree of trees) {
    walkJson(tree, (obj) => {
      const aspects = obj.aspects ?? obj.aspectList ?? obj.skuAspects;
      if (Array.isArray(aspects)) {
        for (const aspect of aspects) {
          const rec = asRecord(aspect);
          if (rec) {
            ingestAspectValues(map, rec, pageUrl, true);
          }
        }
        return;
      }
      ingestAspectValues(map, obj, pageUrl, false);
    });
  }
  return [...map.values()].filter((item) => isSpecAspectName(item.name) && item.values.length >= 2);
}

function extractAspectWidgetChunk(html: string): string {
  const blob = unescapeHtmlBlob(html);
  const start = blob.search(/data-widget="(?:webAspects|aspectsCompact)"/i);
  if (start >= 0) {
    const rest = blob.slice(start);
    const next = rest.slice(24).search(/data-widget="/i);
    return (next >= 0 ? rest.slice(0, 24 + next) : rest).slice(0, 40000);
  }
  const jsonKey = blob.search(/webAspects[^"]{0,80}"\s*:/i);
  if (jsonKey < 0) {
    return '';
  }
  return blob.slice(jsonKey, jsonKey + 80000);
}

function collectWeightFromProductLinks(html: string, pageUrl: string): ProductVariant | null {
  const chunk = extractAspectWidgetChunk(html);
  if (!chunk) {
    return null;
  }
  const family = ozonListingSlugFamily(pageUrl);
  const seen = new Set<string>();
  const values: ProductVariantValue[] = [];
  const re = /\/product\/([a-z0-9\-._%]{3,220})-(\d{6,})/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(chunk)) !== null) {
    const skuId = match[2];
    const sourceUrl = `https://www.ozon.ru/product/${match[1]}-${skuId}/`;
    if (family.split('-').length >= 2 && ozonListingSlugFamily(sourceUrl) !== family) {
      continue;
    }
    const weight = inferWeightOption(match[1].replace(/-/g, ' '), sourceUrl);
    if (!weight || seen.has(weight) || /-\d+-shtuk[ia]?$|-\d+-sht$/i.test(match[1])) {
      continue;
    }
    seen.add(weight);
    values.push({ value: weight, skuId, sourceUrl });
  }
  return values.length >= 2 ? { name: 'Вес товара, г', values } : null;
}

export function mergeVariants(groups: ProductVariant[][]): ProductVariant[] {
  return dedupeVariants(groups.flat()).filter((item) => isSpecAspectName(item.name) && item.values.length >= 2);
}

function collectVariantsFromHtml(html: string, pageUrl: string): ProductVariant[] {
  const chunk = extractAspectWidgetChunk(html);
  if (!chunk) {
    return [];
  }
  const map = new Map<string, ProductVariant>();
  let currentName = '';
  const tokenRe = /<(p|h\d|span|div|a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(chunk)) !== null) {
    const tag = token[1].toLowerCase();
    const attrs = token[2];
    const text = stripTags(token[3]).replace(/\s+/g, ' ').trim();
    const href = attrs.match(/href="([^"]*\/product\/[^"]*)"/i)?.[1] || token[3].match(/href="([^"]*\/product\/[^"]*)"/i)?.[1];
    const imgAlt = token[3].match(/\balt="([^"]+)"/i)?.[1] || '';
    const imgSrc =
      token[3].match(/\bsrc="([^"]+)"/i)?.[1] ||
      attrs.match(/url\(\s*['"]?(https?:\/\/[^)'"\s]+)['"]?\s*\)/i)?.[1] ||
      '';
    const dataSku = attrs.match(/data-sku(?:-id)?="(\d{6,})"/i)?.[1] || '';
    const heading = text.split(':')[0].trim();
    if (
      tag !== 'a' &&
      !href &&
      !imgSrc &&
      heading.length >= 2 &&
      heading.length <= 48 &&
      isSpecAspectName(heading)
    ) {
      currentName = heading;
      if (!map.has(currentName)) {
        map.set(currentName, { name: currentName, values: [] });
      }
      continue;
    }
    if (!text && !imgAlt && !href && !imgSrc && !dataSku) {
      continue;
    }
    if (!currentName) {
      continue;
    }
    const rec = variantValueFrom(
      {
        value: text || imgAlt,
        link: href || '',
        alt: imgAlt,
        image: imgSrc,
        sku: dataSku,
        selected: !href,
      },
      pageUrl,
    );
    if (!rec) {
      continue;
    }
    const current = map.get(currentName) ?? { name: currentName, values: [] };
    if (!current.values.some((item) => item.value === rec.value)) {
      current.values.push(rec);
    }
    map.set(currentName, current);
  }
  return [...map.values()].filter((item) => isSpecAspectName(item.name) && item.values.length >= 2);
}

export function selectedVariantOptions(variants: ProductVariant[] | undefined, skuId = '', name = ''): Record<string, string> {
  return optionsForSku({ skuId, name, variants: variants ?? [] });
}

export function skuOptionFromProduct(
  product: Partial<StandardProduct> & Pick<StandardProduct, 'skuId' | 'name' | 'sourceUrl'>,
): ProductSkuOption {
  return {
    skuId: product.skuId,
    name: product.name,
    sourceUrl: String(product.sourceUrl || '').split('?')[0],
    price: product.price ?? 0,
    originalPrice: product.originalPrice,
    discountPrice: product.discountPrice,
    imageUrls: product.imageUrls ?? [],
    options: optionsForSku({
      skuId: product.skuId,
      name: product.name,
      sourceUrl: product.sourceUrl,
      variants: product.variants,
    }),
  };
}

export function unionSkuOptions(groups: ProductSkuOption[][], variants: ProductVariant[] = []): ProductSkuOption[] {
  const map = new Map<string, ProductSkuOption>();
  for (const group of groups) {
    for (const item of group) {
      const prev = map.get(item.skuId);
      if (!prev || (item.imageUrls?.length || 0) > (prev.imageUrls?.length || 0)) {
        map.set(item.skuId, item);
      } else if (prev && Object.keys(item.options || {}).length > Object.keys(prev.options || {}).length) {
        map.set(item.skuId, { ...prev, options: { ...prev.options, ...item.options } });
      }
    }
  }
  const list = [...map.values()];
  return variants.length ? alignSkuOptions(list, variants) : list;
}

export function buildSkuOptions(
  product: Partial<StandardProduct> & Pick<StandardProduct, 'skuId' | 'name' | 'sourceUrl'>,
): ProductSkuOption[] {
  const variants = dedupeVariants(product.variants ?? []);
  const options: ProductSkuOption[] = [skuOptionFromProduct({ ...product, variants })];
  for (const dim of variants) {
    for (const value of dim.values) {
      const skuId = value.skuId || asSku(value.sourceUrl || '');
      if (!skuId || options.some((item) => item.skuId === skuId)) {
        continue;
      }
      options.push({
        skuId,
        name: `${product.name} / ${value.value}`,
        sourceUrl: (value.sourceUrl || product.sourceUrl).split('?')[0],
        price: value.price || product.price || 0,
        originalPrice: product.originalPrice,
        discountPrice: product.discountPrice,
        imageUrls: value.imageUrls ?? [],
        options: optionsForSku({
          skuId,
          name: `${product.name} ${value.value}`,
          sourceUrl: value.sourceUrl,
          variants,
        }),
      });
    }
  }
  return alignSkuOptions(options, variants);
}

const CHARACTERISTIC_ROW_KEYS = [
  'characteristics',
  'shortCharacteristics',
  'characteristicsList',
  'fullCharacteristics',
  'descriptionCharacteristics',
  'productCharacteristics',
  'attrs',
  'long',
  'short',
  'params',
  'properties',
  'all',
  'groups',
  'sections',
  'rows',
  'blocks',
];

function characteristicText(values: unknown): string {
  if (values == null) {
    return '';
  }
  if (!Array.isArray(values)) {
    return textFromUnknown(values);
  }
  return values
    .map((item) => textFromUnknown(item))
    .filter(Boolean)
    .join(', ');
}

function flattenCharacteristicRows(raw: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => flattenCharacteristicRows(item, depth + 1));
  }
  const rec = asRecord(raw);
  if (!rec) {
    return [];
  }
  const nested = [
    rec.long,
    rec.short,
    rec.all,
    rec.characteristics,
    rec.items,
    rec.groups,
    rec.sections,
    rec.rows,
    rec.blocks,
  ].flatMap((item) => (item && item !== rec ? flattenCharacteristicRows(item, depth + 1) : []));
  const name = textFromUnknown(rec.title ?? rec.name ?? rec.key ?? rec.titleRs).trim();
  const text = characteristicText(rec.values ?? rec.contentRS ?? rec.valueRs ?? rec.value)
    .replace(/\s+/g, ' ')
    .trim();
  if (name && text && name !== '[object Object]' && text !== '[object Object]') {
    return [{ ...rec, __name: name, __value: text }, ...nested];
  }
  return nested;
}

function collectWidgetPageSpecs(trees: unknown[]): ProductSpec[] {
  const specs: ProductSpec[] = [];
  for (const tree of trees) {
    const parsed = parseOzonWidgetPage(tree);
    specs.push(...parsed.warehouse, ...parsed.specs);
  }
  return specs;
}

function collectCharacteristicsFromTree(trees: unknown[]): ProductSpec[] {
  const specs: ProductSpec[] = [];
  for (const tree of trees) {
    walkJson(tree, (obj) => {
      for (const key of CHARACTERISTIC_ROW_KEYS) {
        const rows = flattenCharacteristicRows(obj[key]);
        for (const rec of rows) {
          const name = String(rec.__name || '').trim();
          const text = String(rec.__value || '').trim();
          if (name && text) {
            specs.push({ name, value: text });
          }
        }
      }
    });
  }
  return specs;
}

function parseOzonDimensionString(raw: unknown): { depth: number; width: number; height: number } | null {
  const text = String(raw ?? '')
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
    .trim();
  const match = text.match(
    /^(\d+(?:\.\d+)?)\s*[xх×*]\s*(\d+(?:\.\d+)?)(?:\s*[xх×*]\s*(\d+(?:\.\d+)?))?(?:мм|mm|см|cm)?$/i,
  );
  if (!match || !match[3]) {
    return null;
  }
  const unit = /см|cm/i.test(String(raw ?? '')) && !/мм|mm/i.test(String(raw ?? '')) ? 'cm' : 'mm';
  const toMm = (value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return 0;
    }
    return unit === 'cm' ? num * 10 : num;
  };
  const depth = toMm(match[1]);
  const width = toMm(match[2]);
  const height = toMm(match[3]);
  if (![depth, width, height].every((item) => item > 0 && item < 5000)) {
    return null;
  }
  return { depth, width, height };
}

function readPackageWeightGrams(raw: unknown): number {
  if (typeof raw === 'string') {
    const match = raw.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|g)?/i);
    if (!match) {
      return 0;
    }
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) {
      return 0;
    }
    if (match[2] && /кг|kg/i.test(match[2])) {
      return Math.round(num * 1000);
    }
    return readPackageWeightGrams(num);
  }
  const weight = Number(raw);
  if (!Number.isFinite(weight) || weight <= 0 || weight >= 100_000) {
    return 0;
  }
  if (weight > 0 && weight < 80 && weight % 1 !== 0) {
    return Math.round(weight * 1000);
  }
  return weight;
}

function isLikelyMediaUrl(raw: unknown): boolean {
  return typeof raw === 'string' && (/^https?:\/\//i.test(raw) || /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(raw));
}

function isLikelyMediaObject(obj: Record<string, unknown>): boolean {
  if (obj.dimension != null || obj.weight != null || obj.dimensions != null || obj.packageSize != null) {
    return false;
  }
  return (
    isLikelyMediaUrl(obj.src) ||
    isLikelyMediaUrl(obj.original) ||
    isLikelyMediaUrl(obj.srcset) ||
    isLikelyMediaUrl(obj.previewUrl)
  );
}

function readPackageDimBlob(obj: Record<string, unknown>): {
  depth: number;
  width: number;
  height: number;
  weight: number;
} | null {
  if (isLikelyMediaObject(obj)) {
    return null;
  }
  const nested = asRecord(obj.dimensions);
  const fromString =
    parseOzonDimensionString(obj.dimension) ||
    parseOzonDimensionString(typeof obj.dimensions === 'string' ? obj.dimensions : '') ||
    parseOzonDimensionString(obj.packageSize) ||
    parseOzonDimensionString(typeof obj.volume === 'string' ? obj.volume : '') ||
    parseOzonDimensionString(nested && (nested.dimension || nested.value || nested.text));
  const src = nested ?? obj;
  const depth = fromString ? fromString.depth : Number(src.depth ?? src.length ?? obj.depth ?? obj.length);
  const width = fromString ? fromString.width : Number(src.width ?? obj.width);
  const height = fromString ? fromString.height : Number(src.height ?? obj.height);
  const weight = readPackageWeightGrams(src.weight ?? obj.weight ?? obj.weightGrams ?? obj.packageWeight);
  const hasEdges = [depth, width, height].every((item) => Number.isFinite(item) && item > 0 && item < 5000);
  if (!hasEdges && !(weight > 0)) {
    return null;
  }
  return {
    depth: hasEdges ? depth : 0,
    width: hasEdges ? width : 0,
    height: hasEdges ? height : 0,
    weight,
  };
}

function walkJsonScoped(
  node: unknown,
  visit: (obj: Record<string, unknown>, sku: string) => void,
  depth = 0,
  ancestorSku = '',
): void {
  if (depth > 18 || node == null) {
    return;
  }
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 8) {
      const parsed = parseJsonSafe(trimmed);
      if (parsed) {
        walkJsonScoped(parsed, visit, depth + 1, ancestorSku);
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walkJsonScoped(item, visit, depth + 1, ancestorSku));
    return;
  }
  const rec = asRecord(node);
  if (!rec) {
    return;
  }
  const sku = objectSku(rec) || ancestorSku;
  visit(rec, sku);
  Object.entries(rec).forEach(([key, value]) => {
    if (isRecommendWidgetKey(key)) {
      return;
    }
    walkJsonScoped(value, visit, depth + 1, sku);
  });
}

function collectPackageDimsFromTree(trees: unknown[], pageSku = ''): ProductSpec[] {
  const edges: Array<{ depth: number; width: number; height: number; score: number }> = [];
  const weights: Array<{ weight: number; score: number }> = [];
  const take = (obj: Record<string, unknown>, sku: string, allowUnscoped: boolean) => {
    if (pageSku && sku && sku !== pageSku) {
      return;
    }
    if (pageSku && !sku && !allowUnscoped) {
      return;
    }
    const blob = readPackageDimBlob(obj);
    if (!blob) {
      return;
    }
    const score = pageSku && sku === pageSku ? 2 : 1;
    if (blob.depth && blob.width && blob.height) {
      edges.push({ depth: blob.depth, width: blob.width, height: blob.height, score });
    }
    if (blob.weight > 0) {
      weights.push({ weight: blob.weight, score });
    }
  };
  for (const tree of trees) {
    const rec = asRecord(tree);
    const states = asRecord(rec?.widgetStates);
    if (states) {
      for (const [key, value] of Object.entries(states)) {
        if (isRecommendWidgetKey(key)) {
          continue;
        }
        const parsed = typeof value === 'string' ? parseJsonSafe(value) : value;
        walkJsonScoped(parsed, (obj, sku) => take(obj, sku, isTrustedDimWidgetKey(key)));
      }
      continue;
    }
    walkJsonScoped(tree, (obj, sku) => take(obj, sku, false));
  }
  const pick = <T extends { score: number }>(items: T[]): T | undefined =>
    items.slice().sort((a, b) => b.score - a.score)[0];
  const edge = pick(edges);
  const weight = pick(weights);
  const specs: ProductSpec[] = [];
  if (edge) {
    specs.push(
      { name: 'Длина, мм', value: String(Math.round(edge.depth)) },
      { name: 'Ширина, мм', value: String(Math.round(edge.width)) },
      { name: 'Высота, мм', value: String(Math.round(edge.height)) },
    );
  }
  if (weight) {
    specs.push({ name: 'Вес товара, г', value: String(Math.round(weight.weight)) });
  }
  return specs;
}

function combinedSizeToken(text: string): string | null {
  const match = String(text || '').match(
    /(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm)/i,
  );
  return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}

function hasDimensionSpec(specs: ProductSpec[]): boolean {
  return specs.some((item) =>
    /длина|ширина|высота|глубина|габарит|вес|length|width|height|weight/i.test(item.name),
  );
}

function collectLabeledDescriptionSpecs(description?: string): ProductSpec[] {
  return parseLabeledDescriptionSpecs(description || '');
}

function enrichDimensionSpecs(specs: ProductSpec[], name?: string, description?: string): void {
  if (hasDimensionSpec(specs)) {
    return;
  }
  const token = combinedSizeToken([name, description].filter(Boolean).join(' '));
  if (token) {
    specs.unshift({ name: 'Габариты', value: token });
  }
}

function collectPricesFromTree(trees: unknown[]): {
  price: number;
  originalPrice?: number;
  discountPrice?: number;
} {
  const sane = (value: number) => (value >= 10 && value <= 1_000_000 ? value : 0);
  const candidates: Array<{ original: number; discount: number; sale: number; score: number }> = [];
  for (const tree of trees) {
    walkJson(tree, (obj) => {
      const looksLikePrice =
        'cardPrice' in obj ||
        'originalPrice' in obj ||
        'priceWithoutDiscount' in obj ||
        'marketingPrice' in obj ||
        'discountPrice' in obj ||
        (typeof obj.price === 'string' && String(obj.price).length < 24);
      if (!looksLikePrice) {
        return;
      }
      const original = sane(parseOzonPrice(obj.originalPrice ?? obj.oldPrice ?? obj.priceWithoutDiscount));
      const card = sane(parseOzonPrice(obj.cardPrice ?? obj.finalPrice));
      const marketing = sane(parseOzonPrice(obj.marketingPrice ?? obj.discountPrice));
      const listed = sane(parseOzonPrice(obj.price));
      const sale = card || listed;
      const discount = marketing || (card && listed && listed !== card ? listed : 0) || sale;
      if (!sale && !original) {
        return;
      }
      const score =
        (original ? 4 : 0) + (card ? 3 : 0) + (marketing ? 2 : 0) + (listed ? 1 : 0) + original + sale;
      candidates.push({
        original: original || Math.max(discount, sale),
        discount: discount || sale,
        sale: sale || discount,
        score,
      });
    });
  }
  const picked = candidates.sort((left, right) => right.score - left.score)[0];
  if (!picked) {
    return { price: 0 };
  }
  const sale = picked.sale;
  const discount = picked.discount || sale;
  return {
    price: sale,
    originalPrice: picked.original > sale ? picked.original : undefined,
    discountPrice: discount || sale,
  };
}

function collectDescriptionFromTree(trees: unknown[]): string {
  let best = '';
  for (const tree of trees) {
    walkJson(tree, (obj) => {
      for (const key of ['description', 'richAnnotation', 'text', 'html']) {
        const value = obj[key];
        if (typeof value === 'string') {
          const text = value
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(?:p|div|li|h\d)>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();
          if (text.length > best.length && text.length > 40) {
            best = text;
          }
        }
      }
    });
  }
  return best.slice(0, 8000);
}

function collectBrand(specs: ProductSpec[], trees: unknown[], jsonLd?: Record<string, unknown>): string | undefined {
  const fromLd = brandFromUnknown(jsonLd?.brand);
  if (fromLd) {
    return fromLd;
  }
  const fromSpec = specs.find((item) => /бренд|brand|торговая марка|бренд производителя/i.test(item.name));
  if (fromSpec?.value) {
    return fromSpec.value.trim();
  }
  for (const tree of trees) {
    let brand: string | undefined;
    walkJson(tree, (obj) => {
      const found = brandFromUnknown(obj.brand) || brandFromUnknown(obj.brandName);
      if (found) {
        brand = found;
      }
      if (typeof obj.brandText === 'string' && obj.brandText.trim()) {
        brand = obj.brandText.trim();
      }
    });
    if (brand) {
      return brand;
    }
  }
  return undefined;
}

function brandFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  const nested = asRecord(value);
  if (typeof nested?.name === 'string' && nested.name.trim()) {
    return nested.name.trim();
  }
  if (typeof nested?.title === 'string' && nested.title.trim()) {
    return nested.title.trim();
  }
  return undefined;
}

function collectBreadcrumbs(html: string, jsonLd: Record<string, unknown>[]): string | undefined {
  const crumb = jsonLd.find((item) => item['@type'] === 'BreadcrumbList');
  const elements = Array.isArray(crumb?.itemListElement) ? crumb?.itemListElement : [];
  const names = elements
    .map((item) => {
      const rec = asRecord(item);
      const nested = asRecord(rec?.item);
      return String(rec?.name ?? nested?.name ?? '').trim();
    })
    .filter(Boolean);
  if (names.length) {
    return names.join(' / ');
  }
  const anchors = [...html.matchAll(/data-widget="breadCrumbs"[\s\S]{0,4000}/gi)];
  if (!anchors.length) {
    return undefined;
  }
  const texts = [...anchors[0][0].matchAll(/>([^<]{2,80})</g)].map((item) => stripTags(item[1])).filter(Boolean);
  return texts.length ? texts.join(' / ') : undefined;
}

/** 从商品页 HTML 抽取标准化字段，供 Chrome 插件采集复用 */
export function extractOzonProductFromHtml(html: string, pageUrl: string): Partial<StandardProduct> {
  const jsonLdItems = parseJsonLdProducts(html);
  const jsonLd = jsonLdItems.find((item) => item['@type'] === 'Product' || item.sku || item.offers) ?? {};
  const blob = unescapeHtmlBlob(html);
  const trees = collectJsonTrees(blob);
  const skuId = asSku(jsonLd.sku) || asSku(jsonLd.productID) || pageUrl.match(/(\d{6,})/g)?.pop() || '';
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const name = String(jsonLd.name || (h1 ? stripTags(h1[1]) : '') || '').replace(/\s+/g, ' ').trim();
  const treeDescription = collectDescriptionFromTree(trees);
  const description =
    treeDescription || (typeof jsonLd.description === 'string' ? jsonLd.description.trim() : '') || undefined;
  const og = blob.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  const fromGallery = [
    ...collectGalleryImagesFromTree(trees, blob, skuId),
    ...collectImagesFromWebGalleryHtml(html),
  ];
  const fromLd = collectJsonLdImages(jsonLd);
  const gallery = uniqueOzonImages(
    fromGallery.length ? [...fromGallery, ...fromLd] : [...fromLd, og?.[1]],
  );
  const imageUrls = gallery.length ? gallery : uniqueOzonImages([og?.[1]]);
  const treePrices = collectPricesFromTree(trees);
  const price = offerPrice(jsonLd) || treePrices.price;
  const specs = mergeSpecs([
    collectWidgetPageSpecs(trees),
    collectPackageDimsFromTree(trees, skuId),
    collectCharacteristicsFromTree(trees),
    collectLabeledDescriptionSpecs(description),
    collectJsonLdSpecs(jsonLd),
    collectDlSpecs(html),
  ]);
  warehouseSpecsFromCharacteristics(specs)
    .reverse()
    .forEach((row) => {
      if (!specs.some((item) => item.name === row.name)) {
        specs.unshift(row);
      }
    });
  enrichDimensionSpecs(specs, name, description);
  if (description && !specs.some((item) => item.name === '商品描述')) {
    specs.push({ name: '商品描述', value: description.slice(0, 4000) });
  }
  const weightLinks = collectWeightFromProductLinks(blob, pageUrl);
  const variants = mergeVariants([
    collectVariantsFromTree(trees, pageUrl),
    collectVariantsFromHtml(html, pageUrl),
    weightLinks ? [weightLinks] : [],
  ]);
  const brand = collectBrand(specs, trees, jsonLd);
  const categoryPath = collectBreadcrumbs(html, jsonLdItems);
  const reviewCount = reviewCountOf(jsonLd);
  const skuOptions =
    skuId && name
      ? buildSkuOptions({
          skuId,
          name,
          sourceUrl: pageUrl,
          imageUrls,
          price,
          originalPrice: treePrices.originalPrice,
          discountPrice: treePrices.discountPrice,
          variants,
        })
      : [];

  return {
    skuId,
    name,
    sourceUrl: pageUrl,
    mainImageUrl: imageUrls[0],
    imageUrls,
    videoUrls: collectVideosFromTree(trees),
    price,
    originalPrice: treePrices.originalPrice,
    discountPrice: treePrices.discountPrice,
    currency: 'RUB',
    stock: price > 0 ? 1 : 0,
    specs,
    variants,
    skuOptions,
    categoryPath,
    brand,
    description,
    rating: ratingValue(jsonLd),
    reviewCount: reviewCount || undefined,
    salesCount: reviewCount || 0,
  };
}
