function isChallengePage() {
  const title = document.title || '';
  const heading = (document.querySelector('h1') && document.querySelector('h1').textContent) || '';
  const visible = document.body && document.body.innerText ? document.body.innerText.slice(0, 4000) : '';
  return /доступ ограничен|подтвердите[\s\S]{0,40}не робот|are you a robot|just a moment|access denied|cf-challenge/i.test(
    [title, heading, visible].join('\n'),
  );
}

function isListingLocation() {
  const path = location.pathname || '';
  return /\/(category|search|highlight)\//i.test(path) || path === '/search' || path === '/search/';
}

const LISTING_END_RE = /вы просмотрели все|просмотрены все товары/i;
const LISTING_SCROLL_STEP = 700;
const LISTING_SCROLL_WAIT_MS = 350;
const LISTING_MAX_STALLS = 16;
const LISTING_TIME_BUDGET_MS = 90_000;
const LISTING_MAX_HOPS = 40;
const FETCH_TIMEOUT_MS = 8_000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function listingSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushListingUrl(state, rawPath) {
  const match = String(rawPath || '').match(/\/product\/(?:[a-z0-9\-._%]+-)?(\d{6,})/i);
  if (!match || /mock-/i.test(match[0])) return false;
  if (state.seen[match[1]]) return false;
  state.seen[match[1]] = true;
  state.urls.push('https://www.ozon.ru' + match[0].replace(/\/?$/, '/'));
  return true;
}

function scanListingDom(state) {
  const html = document.documentElement ? document.documentElement.innerHTML : '';
  const re = /\/product\/(?:[a-z0-9\-._%]+-)?(\d{6,})/gi;
  let added = 0;
  let match;
  while ((match = re.exec(html))) {
    if (pushListingUrl(state, match[0])) added += 1;
  }
  return added;
}

/**
 * 品类页翻页只能顺着 nextPage 游标走：游标里的 paginator_token / search_page_state
 * 决定了后续排序，自己拼 page=N 会拿回第一屏的同一批商品。
 * 首跳的游标挂在 infiniteVirtualPaginator 组件里，之后挪到响应顶层，两处都要兜。
 */
async function collectListingViaApi(state, cap) {
  let target = location.pathname + location.search;
  for (let hop = 0; hop < LISTING_MAX_HOPS && state.urls.length < cap; hop += 1) {
    const json = await fetchJson(
      'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=' + encodeURIComponent(target),
    );
    if (!json) return;
    const states = (json && json.widgetStates) || {};
    let widgetNext = null;
    for (const key of Object.keys(states)) {
      let parsed;
      try {
        parsed = JSON.parse(states[key]);
      } catch (_e) {
        continue;
      }
      if (/^(?:tileGrid|searchResults)/i.test(key)) {
        const items = Array.isArray(parsed.items) ? parsed.items : [];
        for (const item of items) {
          const link = item && item.action && item.action.link;
          if (link) pushListingUrl(state, link);
          else if (item && /^\d{6,}$/.test(String(item.id || ''))) pushListingUrl(state, '/product/' + item.id + '/');
          if (state.urls.length >= cap) break;
        }
      }
      if (/paginator/i.test(key) && parsed.nextPage) widgetNext = parsed.nextPage;
    }
    const next = (json && json.nextPage) || widgetNext;
    if (!next) return;
    target = next;
  }
}

/**
 * 游标接口被风控挡住时的兜底。tileGrid 是虚拟滚动，DOM 里同时只挂载约 32 个 tile，
 * 滑过去就卸载，所以必须小步滚 + 每步扫一次，跨度太大会让中间的 tile 挂载又卸载却没被读到。
 */
async function collectListingViaScroll(state, cap) {
  const started = Date.now();
  let stalls = 0;
  while (state.urls.length < cap && stalls < LISTING_MAX_STALLS && Date.now() - started < LISTING_TIME_BUDGET_MS) {
    window.scrollBy(0, LISTING_SCROLL_STEP);
    await listingSleep(LISTING_SCROLL_WAIT_MS);
    if (scanListingDom(state)) {
      stalls = 0;
      continue;
    }
    stalls += 1;
    if (LISTING_END_RE.test(document.body ? document.body.innerText : '')) return;
  }
}

async function extractListing(limit) {
  const cap = Number(limit) > 0 ? Number(limit) : 600;
  const state = { seen: {}, urls: [] };
  scanListingDom(state);
  if (state.urls.length < cap) await collectListingViaApi(state, cap);
  if (state.urls.length < cap) await collectListingViaScroll(state, cap);
  return {
    kind: 'listing',
    urls: state.urls.slice(0, cap),
    blocked: isChallengePage() && state.urls.length === 0,
    sourceUrl: location.href,
  };
}

function parsePrice(raw) {
  if (typeof raw === 'number' && isFinite(raw) && raw > 0) return raw;
  const compact = String(raw || '')
    .replace(/[^\d,.\s]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!compact) return 0;
  if (/^\d+,\d{1,2}$/.test(compact)) return Number(compact.replace(',', '.')) || 0;
  if (/^\d+\.\d{1,2}$/.test(compact)) return Number(compact) || 0;
  const n = Number(compact.replace(/[.,]/g, '')) || 0;
  return n >= 10 && n <= 1000000 ? n : 0;
}

function isOzonMediaHost(raw) {
  let href = String(raw || '').trim();
  if (href.indexOf('//') === 0) href = 'https:' + href;
  try {
    const host = new URL(href).hostname.toLowerCase();
    if (/(?:^|\.)(ozone\.ru|ozonusercontent\.com)$/i.test(host)) return true;
    if (/(?:^|\.)ozonstatic\.[a-z]+$/i.test(host)) return true;
    return /ozon/i.test(host) && /^(ir(?:-\d+)?|cdn\d*)\./i.test(host);
  } catch (_e) {
    return /ozone\.ru|ozonusercontent\.com|ozonstatic\./i.test(raw);
  }
}

function normalizeImage(raw) {
  if (!raw) return null;
  let url = String(raw)
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
  if (url.startsWith('//')) url = 'https:' + url;
  if (url.startsWith('/s3/')) url = 'https://ir.ozone.ru' + url;
  if (!/^https?:\/\//i.test(url)) return null;
  if (!isOzonMediaHost(url)) return null;
  if (/\.(svg|gif)(\?|$)/i.test(url) || /favicon|sprite|logo|pixel|1x1|avatar/i.test(url)) return null;
  return url.replace(/\/(?:wc|wcs)(?:18|28|50|75|100|140|160|180|200|240|250|300|400)\//i, '/wc1200/').split('#')[0];
}

function isGalleryImage(url) {
  if (!url) return false;
  if (/\/cms\/|\/graphics\/|\/icons?\/|\/static\/|\/promo\/|\/bonus\/|\/marketing-api\/|\/banners?\/|searchteam-cdn/i.test(url)) return false;
  if (/(?:^|[/-])(?:logo|icon|badge|banner|sprite|avatar|favicon|payment|flame)(?:[/-]|\.|$)/i.test(url)) return false;
  return /\/s3\/(?:multimedia|rp-photo)/i.test(url) || /\/multimedia(?:-\w+)?\//i.test(url);
}

function uniqueImages(urls) {
  const best = {};
  urls.forEach((item) => {
    const url = normalizeImage(item);
    if (!url || !isGalleryImage(url)) return;
    const key = (url.match(/(?:multimedia|rp-photo)[^/]*\/(?:(?:wc|wcs|c)\d+\/)?([^/?#]+)/i) || [null, url])[1];
    const rank = /\/wc(?:1200|1500|2000|2500)\//i.test(url)
      ? 4
      : /\/wc1000\//i.test(url)
        ? 3
        : /\/(?:multimedia|rp-photo)/i.test(url) && !/\/(?:wc|wcs|c)\d+\//i.test(url)
          ? 5
          : 1;
    if (!best[key] || rank > best[key].rank) best[key] = { url, rank };
  });
  return Object.keys(best)
    .map((k) => best[k])
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 30)
    .map((item) => item.url);
}

function cleanAspectChip(raw) {
  let text = String(raw || '')
    .replace(/выгода\s*\d+\s*%/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/\s+[\d,.]+ *[₽¥].*$/u, '').trim();
  text = text.replace(/\s*\/\s*100.*$/i, '').trim();
  const leadNum = text.match(/^(\d{2,5})(?:\s|$)/);
  if (leadNum) return leadNum[1];
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

function isSpecAspectName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n || /покупают вместе|похожие|рекоменд|смотрели|хиты продаж|вам понрав|другие товар|популярн/i.test(n)) return false;
  return /вес|вкус|цвет|размер|объ[её]м|фасовка|количест|рост|обхват|длин|ширин|высот|модель|комплект|штук|название|аромат|плотность|состав|покрой|рукав|вырез|застежк|color|size|qty|variant/i.test(
    n,
  );
}

function listingSlugFamily(urlOrSlug) {
  const path = String(urlOrSlug || '').split('?')[0].toLowerCase();
  const slug =
    (path.match(/\/product\/([a-z0-9\-._%]+)-\d{6,}/i) || [])[1] ||
    path.replace(/^.*\//, '').replace(/-\d{6,}$/, '');
  const parts = String(slug)
    .replace(/-\d{2,5}-g(?:r)?$/i, '')
    .replace(/-1-kg$/i, '')
    .replace(/-\d+-kg$/i, '')
    .replace(/-\d+-shtuk[ia]?$/i, '')
    .replace(/-\d+-sht$/i, '')
    .replace(/-\d+-pieces?$/i, '')
    .split('-')
    .filter(Boolean);
  if (parts.length >= 3) parts.pop();
  return parts.join('-');
}

function inferWeightFrom(name, sourceUrl) {
  const blob = String(name || '') + ' ' + String(sourceUrl || '');
  if (/\b1(?:[.,]0)?\s*кг|\b1-kg\b|\b1000[\s-]*g\b/i.test(blob)) return '1000';
  const grams = blob.match(/(\d{2,4})\s*г(?![а-яё])/i) || blob.match(/(\d{2,4})-g\b/i);
  return grams ? grams[1] : '';
}

function aspectChipValue(rec) {
  const data = (rec && rec.data) || {};
  const content = (data && data.content) || rec.content || {};
  const title = typeof rec.title === 'object' && rec.title ? rec.title : data.title;
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
    rec.content,
    data.text,
    data.value,
    data.name,
    data.key,
    data.ariaLabel,
    data.alt,
    data.color,
    content.text,
    title && title.text,
    typeof rec.title === 'string' ? rec.title : '',
    typeof data.title === 'string' ? data.title : '',
  ];
  const cleaned = parts.map((item) => cleanAspectChip(item)).filter(Boolean);
  const numeric = cleaned.find((item) => /^\d{2,5}$/.test(item));
  if (numeric) return numeric;
  const joined = cleanAspectChip(parts.filter((item) => item != null && item !== '').join(' '));
  return joined || cleaned[0] || '';
}

function extractProductHref(rec, depth) {
  if (depth > 4 || rec == null) return '';
  if (typeof rec === 'string') {
    const match = rec.match(/https?:\/\/[^"' \s<>]*ozon\.ru\/product\/[^"'?\s<>]+/i) || rec.match(/\/product\/[a-z0-9\-._%]+/i);
    return match ? match[0] : '';
  }
  if (typeof rec !== 'object') return '';
  const keys = ['link', 'href', 'url', 'deepLink', 'relativeUrl', 'canonicalUrl', 'pathname', 'action', 'clickUrl', 'targetUrl'];
  for (let i = 0; i < keys.length; i += 1) {
    const found = extractProductHref(rec[keys[i]], (depth || 0) + 1);
    if (found) return found;
  }
  return extractProductHref(rec.data, (depth || 0) + 1);
}

function rememberGroupName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .split(':')[0]
    .replace(/:$/, '')
    .trim();
}

function asSku(value) {
  if (typeof value === 'number' && isFinite(value)) return String(value);
  const text = String(value || '').trim();
  if (!text) return '';
  const path = text.split('?')[0].split('#')[0];
  const slug = path.match(/-(\d{6,})\/?$/);
  if (slug) return slug[1];
  const match = path.match(/(\d{6,})/g);
  return match ? match[match.length - 1] : '';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

function extractObjectAt(source, start) {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < Math.min(source.length, start + 6000000); i += 1) {
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
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return parseJson(source.slice(start, i + 1));
    }
  }
  return null;
}

function walk(node, visit, depth) {
  if (depth > 18 || node == null) return;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if ((trimmed[0] === '{' || trimmed[0] === '[') && trimmed.length > 8) {
      const parsed = parseJson(trimmed);
      if (parsed) walk(parsed, visit, depth + 1);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  Object.keys(node).forEach((key) => walk(node[key], visit, depth + 1));
}

function asPositiveInt(raw) {
  const n = typeof raw === 'number' ? raw : Number(String(raw == null ? '' : raw).replace(/\s+/g, '').replace(',', '.'));
  if (!isFinite(n) || n < 0 || n > 10000000) return undefined;
  return Math.round(n);
}

function collectAvailability(trees, fallbackStock) {
  let fboStock = 0;
  let fbsStock = 0;
  let totalStock = 0;
  let sawFbo = false;
  let sawFbs = false;
  const named = (obj, keys) => {
    for (let i = 0; i < keys.length; i += 1) {
      if (obj[keys[i]] == null) continue;
      const value = asPositiveInt(obj[keys[i]]);
      if (value != null) return value;
    }
    return undefined;
  };
  trees.forEach((tree) => {
    walk(tree, (obj) => {
      const blob = [
        obj.deliverySchema,
        obj.availabilityType,
        obj.warehouseType,
        obj.fulfillmentType,
        obj.deliveryType,
        obj.salesSchema,
        obj.schema,
        obj.title,
        obj.text,
        obj.name,
      ]
        .map((item) => String(item || ''))
        .join(' ')
        .toLowerCase()
        .replace(/ё/g, 'е');
      const fboFlag = /\bfbo\b/.test(blob) || /склад\s+ozon|со склада ozon|ozon склад/.test(blob);
      const fbsFlag = /\bfbs\b/.test(blob) || /склад\s+продавц|со склада продавц/.test(blob);
      const fboNamed = named(obj, ['fboStock', 'stockFbo', 'fboCount', 'fboQty', 'availableFbo']);
      const fbsNamed = named(obj, ['fbsStock', 'stockFbs', 'fbsCount', 'fbsQty', 'availableFbs']);
      const generic = named(obj, [
        'availableStock',
        'availableCount',
        'availableAmount',
        'stockCount',
        'freeStock',
        'leftover',
        'remains',
        'qty',
        'quantity',
        'stock',
      ]);
      if (fboNamed != null) {
        fboStock = Math.max(fboStock, fboNamed);
        sawFbo = true;
      }
      if (fbsNamed != null) {
        fbsStock = Math.max(fbsStock, fbsNamed);
        sawFbs = true;
      }
      if (generic != null) {
        if (fboFlag && !fbsFlag) {
          fboStock = Math.max(fboStock, generic);
          sawFbo = true;
        } else if (fbsFlag && !fboFlag) {
          fbsStock = Math.max(fbsStock, generic);
          sawFbs = true;
        } else {
          totalStock = Math.max(totalStock, generic);
        }
      } else if (fboFlag) sawFbo = true;
      else if (fbsFlag) sawFbs = true;
    });
  });
  const stock = Math.max(totalStock, fboStock, fbsStock, fallbackStock || 0);
  return {
    stock,
    fboStock: fboStock > 0 || sawFbo ? fboStock : undefined,
    fbsStock: fbsStock > 0 || sawFbs ? fbsStock : undefined,
    warehouseType: sawFbo && sawFbs ? 'MIXED' : sawFbo ? 'FBO' : sawFbs ? 'FBS' : undefined,
  };
}

function isRecommendWidgetKey(key) {
  return /tileGrid|skuGrid|recommend|similar|alsoBuy|boughtTogether|webList|collection|related|catalogMenu|tapTags|horizontalMenu|bigPromo/i.test(
    String(key || ''),
  );
}

function isPdpGalleryWidgetKey(key) {
  if (isRecommendWidgetKey(key)) return false;
  const name = String(key || '').split('-')[0];
  return /^(webGallery|galleryMobile|pdpGallery|webProductGallery|webPhotoGallery|productGallery)$/i.test(name);
}

function collectGalleryWidgetUrls(raw, urls) {
  if (!raw || typeof raw !== 'object' || raw.tileImage || raw.mainState) return;
  if (raw.coverImage) pushImageUrls(urls, raw.coverImage, 0);
  if (raw.coverImageUrl) pushImageUrls(urls, raw.coverImageUrl, 0);
  ['images', 'media', 'photos', 'gallery'].forEach((key) => {
    if (!Array.isArray(raw[key])) return;
    raw[key].forEach((item) => {
      if (typeof item === 'string') urls.push(item);
      else if (item) pushImageUrls(urls, item, 0);
    });
  });
}

function collectGalleryFromTrees(trees, urls, skuId) {
  trees.forEach((tree) => {
    const states = tree && tree.widgetStates;
    if (!states || typeof states !== 'object') return;
    Object.keys(states).forEach((key) => {
      if (isRecommendWidgetKey(key)) return;
      let widget = states[key];
      if (typeof widget === 'string') widget = parseJson(widget);
      if (!isPdpGalleryWidgetKey(key)) return;
      collectGalleryWidgetUrls(widget, urls);
    });
  });
}

function collectTrees(html) {
  const trees = [];
  const marker = html.indexOf('"widgetStates"');
  if (marker >= 0) {
    const brace = html.indexOf('{', marker);
    const parsed = brace >= 0 ? extractObjectAt(html, brace) : null;
    if (parsed) trees.push(parsed);
  }
  document.querySelectorAll('script[type="application/json"]').forEach((node) => {
    const parsed = parseJson(node.textContent || '');
    if (parsed) trees.push(parsed);
  });
  document.querySelectorAll('[data-state]').forEach((node) => {
    const parsed = parseJson(node.getAttribute('data-state') || '');
    if (parsed) trees.push(parsed);
  });
  return trees;
}

function pushImageUrls(urls, raw, depth) {
  if (depth > 5 || raw == null) return;
  if (typeof raw === 'string') {
    if (raw.indexOf('/s3/') === 0) urls.push('https://ir.ozone.ru' + raw);
    else if (raw.indexOf('http') === 0 || raw.indexOf('//') === 0) urls.push(raw);
    return;
  }
  if (Array.isArray(raw)) {
    raw.forEach((item) => pushImageUrls(urls, item, depth + 1));
    return;
  }
  if (typeof raw !== 'object') return;
  const w = Number(raw.width || raw.w);
  const h = Number(raw.height || raw.h);
  if (isFinite(w) && isFinite(h) && Math.max(w, h) > 0 && Math.max(w, h) < 200) return;
  if (/logo|icon|badge|banner|payment/i.test(String(raw.type || raw.kind || raw.role || ''))) return;
  ['original', 'src', 'url', 'image', 'coverImage', 'coverImageUrl', 'previewUrl', 'srcBig', 'picture', 'file_name', 'link'].forEach(
    (key) => {
      if (raw[key]) pushImageUrls(urls, raw[key], depth + 1);
    },
  );
}

function specLabel(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string' || typeof raw === 'number') {
    const text = String(raw).replace(/\s+/g, ' ').trim();
    return text === '[object Object]' ? '' : text;
  }
  if (Array.isArray(raw)) return raw.map(specLabel).filter(Boolean).join(', ');
  if (typeof raw !== 'object') return '';
  return specLabel(
      raw.text ||
      raw.content ||
      raw.textRs ||
      raw.textAtom ||
      raw.contentRS ||
      raw.valueRs ||
      raw.titleRs ||
      raw.title ||
      raw.value ||
      raw.name ||
      raw.label ||
      raw.key ||
      raw.caption,
  );
}

function asCharRows(raw, depth) {
  if (!raw || (depth || 0) > 5) return [];
  if (Array.isArray(raw)) return raw.flatMap((item) => asCharRows(item, (depth || 0) + 1));
  if (typeof raw !== 'object') return [];
  const nested = []
    .concat(Array.isArray(raw.long) ? raw.long : [])
    .concat(Array.isArray(raw.short) ? raw.short : [])
    .concat(Array.isArray(raw.all) ? raw.all : [])
    .concat(Array.isArray(raw.characteristics) ? raw.characteristics : [])
    .concat(Array.isArray(raw.items) ? raw.items : [])
    .concat(Array.isArray(raw.groups) ? raw.groups : [])
    .concat(Array.isArray(raw.sections) ? raw.sections : []);
  if (nested.length) return nested.flatMap((item) => asCharRows(item, (depth || 0) + 1));
  if (raw.title || raw.name || raw.key || raw.titleRs || raw.value || raw.valueRs || raw.contentRS || raw.values) {
    return [raw];
  }
  return [];
}

function addSpec(specs, name, value) {
  const n = specLabel(name);
  const v = specLabel(value);
  if (!n || !v || n === '[object Object]' || v === '[object Object]' || n.length > 80 || v.length > 800) return;
  if (
    /^(Длина, мм|Ширина, мм|Высота, мм|Вес товара, г|Длина упаковки, мм|Ширина упаковки, мм|Высота упаковки, мм|Вес брутто, г)$/.test(
      n,
    ) &&
    specs.some((item) => item.name === n)
  ) {
    return;
  }
  if (specs.some((item) => item.name === n && item.value === v)) return;
  specs.push({ name: n, value: v });
}

function extract(payload) {
  payload = payload || {};
  const jsonLdNodes = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
    const parsed = parseJson(node.textContent || 'null');
    const items = Array.isArray(parsed) ? parsed : [parsed];
    items.forEach((item) => {
      if (item && (item['@type'] === 'Product' || item.name)) jsonLdNodes.push(item);
    });
  });
  const jsonLd = jsonLdNodes[0] || {};
  const html = (document.documentElement ? document.documentElement.innerHTML : '')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/');
  const trees = collectTrees(html);
  const composerPages = Array.isArray(payload.composerPages) ? payload.composerPages : [];
  composerPages.forEach((page) => {
    if (page) trees.push(page);
  });
  const extraImageUrls = Array.isArray(payload.extraImageUrls) ? payload.extraImageUrls : [];
  const dimSpecs = Array.isArray(payload.dimSpecs) ? payload.dimSpecs : [];

  const name =
    jsonLd.name ||
    (document.querySelector('h1') && document.querySelector('h1').textContent.trim()) ||
    (document.querySelector('[data-widget="webProductHeading"]') &&
      document.querySelector('[data-widget="webProductHeading"]').textContent.trim()) ||
    document.title;
  const sku =
    jsonLd.sku ||
    jsonLd.productID ||
    (document.querySelector('meta[itemprop="sku"]') &&
      document.querySelector('meta[itemprop="sku"]').getAttribute('content')) ||
    (location.pathname.match(/(\d{6,})/) || [null, ''])[1];

  const urls = extraImageUrls.slice();
  const videos = [];
  const variantsMap = {};
  const specs = [];
  let treePrice = 0;
  let originalPrice = 0;
  let discountPrice = 0;
  let description = String(jsonLd.description || '').trim();
  let brand = '';
  if (typeof jsonLd.brand === 'string' && jsonLd.brand.trim()) brand = jsonLd.brand.trim();
  else if (jsonLd.brand && typeof jsonLd.brand.name === 'string') brand = jsonLd.brand.name.trim();

  function rememberVariant(groupName, rec) {
    rec = rec || {};
    const data = rec.data || {};
    let value = aspectChipValue(rec);
    groupName = rememberGroupName(groupName);
    const link = extractProductHref(rec.link) || extractProductHref(rec.href) || extractProductHref(rec.url) || extractProductHref(rec.action) || extractProductHref(data);
    const sourceUrl = link
      ? link.indexOf('http') === 0
        ? link.split('?')[0]
        : 'https://www.ozon.ru' + (link.charAt(0) === '/' ? link : '/' + link)
      : undefined;
    const skuId = asSku(sourceUrl) || asSku(rec.sku || rec.skuId || data.sku) || undefined;
    if (!value) value = inferWeightFrom(rec.searchableText || rec.title || '', sourceUrl || '');
    if (!value && (skuId || rec.image || rec.src || (data && data.image))) {
      value = cleanAspectChip(rec.ariaLabel || rec['aria-label'] || rec.alt || data.alt || '') || (skuId ? 'вариант ' + skuId : '');
    }
    if (!groupName || !isSpecAspectName(groupName) || !value) return;
    if (!variantsMap[groupName]) variantsMap[groupName] = { name: groupName, values: [] };
    if (variantsMap[groupName].values.some((item) => item.value === value)) return;
    const swatch = rec.image || rec.src || rec.preview || (data && (data.image || data.src));
    variantsMap[groupName].values.push({
      value,
      selected: Boolean(rec.isSelected || rec.selected || rec.active || rec.checked || data.active),
      skuId,
      sourceUrl: sourceUrl || (skuId ? 'https://www.ozon.ru/product/' + skuId + '/' : undefined),
      price: parsePrice(rec.price || rec.cardPrice) || undefined,
      imageUrls: typeof swatch === 'string' ? [swatch] : swatch && swatch.src ? [swatch.src] : undefined,
    });
  }

  trees.forEach((tree) => {
    walk(
      tree,
      (obj) => {
        if (typeof obj.videoUrl === 'string') videos.push(obj.videoUrl);
        if (Array.isArray(obj.aspects) || Array.isArray(obj.aspectList) || Array.isArray(obj.skuAspects)) {
          (obj.aspects || obj.aspectList || obj.skuAspects).forEach((aspect) => {
            const data = aspect && aspect.data;
            const groupName = String(
              (aspect && (aspect.name || aspect.title || aspect.key || aspect.aspectName)) || (data && data.title) || '',
            ).trim();
            const values =
              (aspect &&
                (aspect.aspectValues ||
                  aspect.values ||
                  aspect.items ||
                  aspect.variants ||
                  aspect.options ||
                  aspect.buttons ||
                  aspect.pills ||
                  aspect.rs ||
                  aspect.cs)) ||
              [];
            if (isSpecAspectName(groupName) && Array.isArray(values)) values.forEach((item) => rememberVariant(groupName, item || {}));
          });
        } else {
          const data = obj.data;
          const groupName = String(obj.name || obj.title || obj.key || obj.aspectName || (data && data.title) || '').trim();
          const values =
            obj.aspectValues ||
            obj.variants ||
            obj.options ||
            obj.values ||
            obj.items ||
            obj.buttons ||
            obj.pills ||
            obj.rs ||
            obj.cs;
          if (isSpecAspectName(groupName) && groupName && Array.isArray(values) && values.length >= 2) {
            values.forEach((item) => rememberVariant(groupName, item || {}));
          }
        }
        const charRows = []
          .concat(asCharRows(obj.characteristics))
          .concat(asCharRows(obj.shortCharacteristics))
          .concat(asCharRows(obj.characteristicsList))
          .concat(asCharRows(obj.fullCharacteristics))
          .concat(asCharRows(obj.descriptionCharacteristics))
          .concat(asCharRows(obj.productCharacteristics))
          .concat(asCharRows(obj.attrs))
          .concat(asCharRows(obj.long))
          .concat(asCharRows(obj.short))
          .concat(asCharRows(obj.all))
          .concat(asCharRows(obj.params))
          .concat(asCharRows(obj.properties))
          .concat(asCharRows(obj.groups))
          .concat(asCharRows(obj.sections))
          .concat(asCharRows(obj.blocks));
        charRows.forEach((row) => {
          const title = row && (row.title || row.name || row.key);
          const values =
            row &&
            (row.values !== undefined
              ? row.values
              : row.contentRS !== undefined
                ? row.contentRS
                : row.valueRs !== undefined
                  ? row.valueRs
                  : row.value);
          addSpec(specs, title, Array.isArray(values) ? values.map(specLabel).filter(Boolean).join(', ') : values);
        });
        const dimNested = obj.dimensions && typeof obj.dimensions === 'object' ? obj.dimensions : null;
        const dimSrc = dimNested || obj;
        const looksLikeMedia =
          obj.dimension == null &&
          obj.weight == null &&
          !obj.dimensions &&
          ((typeof obj.src === 'string' && /^https?:\/\//i.test(obj.src)) ||
            (typeof obj.original === 'string' && /^https?:\/\//i.test(obj.original)) ||
            (typeof obj.srcset === 'string' && obj.srcset) ||
            (typeof obj.previewUrl === 'string' && /^https?:\/\//i.test(obj.previewUrl)));
        if (!looksLikeMedia) {
          const dimText = [obj.dimension, typeof obj.dimensions === 'string' ? obj.dimensions : '', obj.packageSize, obj.volume]
            .map((item) => String(item || '').replace(/,/g, '.').replace(/\s+/g, '').trim())
            .find((item) => /^\d+(?:\.\d+)?[xх×*]\d+(?:\.\d+)?[xх×*]\d+(?:\.\d+)?/i.test(item));
          const dimMatch = dimText
            ? dimText.match(/^(\d+(?:\.\d+)?)[xх×*](\d+(?:\.\d+)?)[xх×*](\d+(?:\.\d+)?)(?:мм|mm|см|cm)?$/i)
            : null;
          const asCm = dimText && /см|cm/i.test(String(obj.dimension || obj.dimensions || '')) && !/мм|mm/i.test(String(obj.dimension || obj.dimensions || ''));
          const fromString = dimMatch
            ? {
                depth: Number(dimMatch[1]) * (asCm ? 10 : 1),
                width: Number(dimMatch[2]) * (asCm ? 10 : 1),
                height: Number(dimMatch[3]) * (asCm ? 10 : 1),
              }
            : null;
          const depth = fromString
            ? fromString.depth
            : Number(dimSrc.depth != null ? dimSrc.depth : dimSrc.length != null ? dimSrc.length : obj.depth != null ? obj.depth : obj.length);
          const width = fromString ? fromString.width : Number(dimSrc.width != null ? dimSrc.width : obj.width);
          const height = fromString ? fromString.height : Number(dimSrc.height != null ? dimSrc.height : obj.height);
          const rawWeight = dimSrc.weight != null ? dimSrc.weight : obj.weight != null ? obj.weight : obj.weightGrams;
          let weight = Number(rawWeight);
          if (isFinite(weight) && weight > 0 && weight < 80 && weight % 1 !== 0) weight = Math.round(weight * 1000);
          if ([depth, width, height].every((item) => isFinite(item) && item > 0 && item < 5000)) {
            addSpec(specs, 'Длина, мм', String(Math.round(depth)));
            addSpec(specs, 'Ширина, мм', String(Math.round(width)));
            addSpec(specs, 'Высота, мм', String(Math.round(height)));
            if (isFinite(weight) && weight > 0 && weight < 100000) addSpec(specs, 'Вес товара, г', String(Math.round(weight)));
          } else if (fromString && isFinite(weight) && weight > 0 && weight < 100000) {
            addSpec(specs, 'Вес товара, г', String(Math.round(weight)));
          }
        }
        if (
          obj.cardPrice ||
          obj.originalPrice ||
          obj.marketingPrice ||
          obj.discountPrice ||
          (typeof obj.price === 'string' && String(obj.price).length < 24)
        ) {
          const card = parsePrice(obj.cardPrice || obj.finalPrice);
          const listed = parsePrice(obj.price);
          const marketing = parsePrice(obj.marketingPrice || obj.discountPrice);
          const original = parsePrice(obj.originalPrice || obj.oldPrice || obj.priceWithoutDiscount);
          const sale = card || listed;
          const discount = marketing || (card && listed && listed !== card ? listed : 0) || sale;
          if (sale > treePrice) treePrice = sale;
          if (discount > discountPrice) discountPrice = discount;
          if (original > originalPrice) originalPrice = original;
        }
        if (typeof obj.description === 'string' && obj.description.replace(/<[^>]+>/g, ' ').trim().length > description.length) {
          description = obj.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        if (typeof obj.brand === 'string' && obj.brand.trim()) brand = obj.brand.trim();
        if (obj.brand && typeof obj.brand.name === 'string') brand = obj.brand.name.trim();
      },
      0,
    );
  });

  dimSpecs.forEach((item) => addSpec(specs, item && item.name, item && item.value));

  collectGalleryFromTrees(trees, urls, sku);
  document
    .querySelectorAll(
      '[data-widget*="webGallery"], [data-widget="galleryMobile"], [data-widget="pdpGallery"], [data-widget="webProductGallery"], [id*="webGallery"], [id*="state-webGallery"]',
    )
    .forEach((root) => {
      collectGalleryWidgetUrls(parseJson(root.getAttribute('data-state') || ''), urls);
      root.querySelectorAll('img, source').forEach((img) => {
        urls.push(img.currentSrc || img.src || '');
        ['src', 'data-src', 'data-original', 'data-lazy', 'data-zoom-src', 'data-srcset', 'srcset'].forEach((attr) => {
          const raw = img.getAttribute && img.getAttribute(attr);
          if (!raw) return;
          raw.split(',').forEach((part) => urls.push(part.trim().split(' ')[0]));
        });
      });
    });
  const og = document.querySelector('meta[property="og:image"]');
  if (og) urls.push(og.content);
  if (jsonLd.image) {
    const images = Array.isArray(jsonLd.image) ? jsonLd.image : [jsonLd.image];
    images.forEach((item) => urls.push(typeof item === 'string' ? item : item && item.url));
  }

  function aspectHeading(el, root) {
    let node = el.parentElement;
    for (let i = 0; i < 8 && node && node !== root; i += 1) {
      const prev = node.previousElementSibling;
      const t = prev ? (prev.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const label = t.split(':')[0].trim();
      if (label && label.length < 48 && isSpecAspectName(label)) return label;
      node = node.parentElement;
    }
    return '';
  }
  const aspectRoot = document.querySelector('[data-widget="webAspects"], [data-widget="aspectsCompact"]');
  if (aspectRoot) {
    aspectRoot.querySelectorAll('a[href*="/product/"], button, [role="radio"], [role="option"], [role="button"], [data-sku], [data-sku-id]').forEach((el) => {
      const img = el.querySelector && el.querySelector('img');
      const raw =
        (el.textContent || '').replace(/\s+/g, ' ').trim() ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        (img && (img.getAttribute('alt') || img.getAttribute('title'))) ||
        '';
      if ((!raw || raw.length > 160) && !img) return;
      const link =
        el.getAttribute('href') ||
        (el.closest && el.closest('a') && el.closest('a').getAttribute('href')) ||
        '';
      const skuAttr = el.getAttribute('data-sku') || el.getAttribute('data-sku-id') || '';
      const group = aspectHeading(el, aspectRoot);
      if (!group || !isSpecAspectName(group)) return;
      rememberVariant(group, {
        value: raw,
        link,
        ariaLabel: el.getAttribute('aria-label') || (img && img.getAttribute('alt')),
        image: img && (img.currentSrc || img.src),
        selected:
          el.getAttribute('aria-pressed') === 'true' ||
          el.getAttribute('aria-checked') === 'true' ||
          el.getAttribute('aria-current') === 'true',
        sku: skuAttr || (el.getAttribute('aria-pressed') === 'true' ? String(sku || '') : undefined),
      });
    });
    const family = listingSlugFamily(location.href);
    const linkRe = /\/product\/([a-z0-9\-._%]{3,220})-(\d{6,})/gi;
    let linkMatch;
    const rootHtml = aspectRoot.innerHTML || '';
    while ((linkMatch = linkRe.exec(rootHtml))) {
      const skuId = linkMatch[2];
      const sourceUrl = 'https://www.ozon.ru/product/' + linkMatch[1] + '-' + skuId + '/';
      if (family.split('-').length >= 2 && listingSlugFamily(sourceUrl) !== family) continue;
      const weight = inferWeightFrom(linkMatch[1].replace(/-/g, ' '), sourceUrl);
      if (weight && /-\d+-g|-1-kg|-\d+-kg/i.test(linkMatch[1])) {
        rememberVariant('Вес товара, г', { value: weight, link: sourceUrl, sku: skuId });
      }
    }
  }

  (jsonLd.additionalProperty
    ? Array.isArray(jsonLd.additionalProperty)
      ? jsonLd.additionalProperty
      : [jsonLd.additionalProperty]
    : []
  ).forEach((item) => addSpec(specs, item && item.name, item && item.value));
  document
    .querySelectorAll(
      '[data-widget="webCharacteristics"] dt, [data-widget="webShortCharacteristics"] dt, #section-characteristics dt',
    )
    .forEach((dt) => addSpec(specs, dt.textContent, dt.nextElementSibling && dt.nextElementSibling.textContent));
  document
    .querySelectorAll('[data-widget="webCharacteristics"] tr, [data-widget="webShortCharacteristics"] tr, #section-characteristics tr')
    .forEach((tr) => {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length >= 2) addSpec(specs, cells[0].textContent, cells[1].textContent);
    });
  const sellerNode = document.querySelector('[data-widget="webCurrentSeller"]');
  if (sellerNode) {
    const seller = String(sellerNode.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/[•|]/)[0]
      .trim();
    if (seller) addSpec(specs, 'Продавец', seller.slice(0, 80));
  }
  const brandNode = document.querySelector('[data-widget="webBrand"]');
  if (brandNode && !brand) {
    brand = String(brandNode.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/[•|]/)[0]
      .trim();
  }

  const descNode = document.querySelector(
    '#section-description, [data-widget="webDescription"], [data-widget="webProductDescription"], [itemprop="description"]',
  );
  if (descNode && descNode.innerText && descNode.innerText.trim().length > description.length) {
    description = descNode.innerText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
  }
  const labeled = [];
  const labeledRe = /(?:^|[\n;；])\s*([A-Za-zА-ЯЁа-яё][^:\n]{0,40}?)\s*[:：][^\S\n]*/g;
  const descText = String(description || '').replace(/\\n/g, '\n');
  let labeledMatch;
  while ((labeledMatch = labeledRe.exec(descText))) {
    labeled.push({ name: labeledMatch[1].trim(), start: labeledMatch.index, valueStart: labeledMatch.index + labeledMatch[0].length });
  }
  labeled.forEach((item, i) => {
    const value = descText
      .slice(item.valueStart, labeled[i + 1] ? labeled[i + 1].start : descText.length)
      .replace(/\s+/g, ' ')
      .trim();
    if (item.name && value) addSpec(specs, item.name, value);
  });
  const hasLogisticsSize = specs.some((item) => item.name === 'Длина, мм') &&
    specs.some((item) => item.name === 'Ширина, мм') &&
    specs.some((item) => item.name === 'Высота, мм');
  const hasDimSpec = hasLogisticsSize || specs.some((item) =>
    /длина|ширина|высота|глубина|габарит|вес товара|вес брутто|вес с упаков|length|width|height|weight/i.test(item.name),
  );
  if (!hasDimSpec) {
    const sizeMatch = [name, description]
      .filter(Boolean)
      .join(' ')
      .match(/(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(мм|mm|см|cm)/i);
    if (sizeMatch) addSpec(specs, 'Габариты', sizeMatch[0].replace(/\s+/g, ' ').trim());
  }
  if (description) addSpec(specs, '商品描述', description.slice(0, 4000));

  const crumbs = [];
  document.querySelectorAll('[data-widget="breadCrumbs"] a, nav[aria-label] a').forEach((a) => {
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) crumbs.push(text);
  });

  const offers = jsonLd.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const priceNode = document.querySelector('[data-widget="webPrice"], [data-widget="webSale"]');
  const price = parsePrice((offer && offer.price) || treePrice || (priceNode && priceNode.textContent)) || treePrice;
  const variants = Object.keys(variantsMap)
    .map((key) => variantsMap[key])
    .filter((item) => isSpecAspectName(item.name) && item.values.length >= 2);
  const imageUrls = uniqueImages(urls);
  const trimmedName = String(name || '').trim();
  const alignedVariants = variants
    .map((item) => {
      const current =
        item.values.find((value) => value.skuId && value.skuId === String(sku)) ||
        item.values.find((value) => value.selected) ||
        item.values.find((value) => trimmedName.includes(value.value));
      return {
        ...item,
        values: item.values.map((value) => ({
          ...value,
          selected: Boolean(current && value.value === current.value),
        })),
      };
    });
  const ratingRaw = jsonLd.aggregateRating && jsonLd.aggregateRating.ratingValue;
  const rating = ratingRaw ? Number(String(ratingRaw).replace(',', '.')) : undefined;
  const reviewCount = parsePrice(jsonLd.aggregateRating && (jsonLd.aggregateRating.reviewCount || jsonLd.aggregateRating.ratingCount));
  const usable = Boolean(sku && trimmedName && !/^ozon\.?$/i.test(trimmedName));
  if (!usable && isChallengePage()) return { blocked: true };
  const availability = collectAvailability(trees, price > 0 ? 1 : 0);

  return {
    skuId: String(sku || ''),
    name: trimmedName,
    sourceUrl: location.href,
    mainImageUrl: imageUrls[0],
    imageUrls,
    videoUrls: videos.filter((item, i, arr) => item && arr.indexOf(item) === i).slice(0, 8),
    price,
    originalPrice: originalPrice > price ? originalPrice : undefined,
    discountPrice: discountPrice || (originalPrice > price ? price : undefined),
    currency: (offer && offer.priceCurrency) || 'RUB',
    stock: availability.stock,
    fboStock: availability.fboStock,
    fbsStock: availability.fbsStock,
    warehouseType: availability.warehouseType,
    specs,
    variants: alignedVariants,
    categoryPath: crumbs.length ? crumbs.join(' / ') : undefined,
    brand: brand || (specs.find((item) => /бренд|brand|торговая марка/i.test(item.name)) || {}).value,
    description: description || undefined,
    rating: isFinite(rating) ? rating : undefined,
    reviewCount: reviewCount || undefined,
    salesCount: undefined,
  };
}

async function fetchComposerPages() {
  const origin = location.origin || 'https://www.ozon.ru';
  const sku = (location.pathname.match(/(\d{6,})/) || [null, ''])[1];
  if (!sku) return [];
  const path = (location.pathname.endsWith('/') ? location.pathname : location.pathname + '/') || '/product/' + sku + '/';
  const entry = origin + '/api/entrypoint-api.bx/page/json/v2?url=';
  const qs = new URLSearchParams(String(location.search || '').replace(/^\?/, ''));
  qs.set('oos_search', 'false');
  const page2 = new URLSearchParams(qs.toString());
  page2.set('layout_container', 'pdpPage2column');
  page2.set('layout_page_index', '2');
  const urls = [
    entry + encodeURIComponent(path + '?' + qs.toString()),
    entry + encodeURIComponent(path + '?' + page2.toString()),
    entry + encodeURIComponent('/modal/size-table?product_id=' + sku + '&page_changed=true'),
    entry + encodeURIComponent('/modal/aspectsNew?product_id=' + sku + '&page_changed=true'),
  ];
  const pages = [];
  const results = await Promise.all(
    urls.map(async (url) => {
      const json = await fetchJson(url);
      if (json && !json.incidentId) return json;
      return null;
    }),
  );
  results.forEach((json) => {
    if (json) pages.push(json);
  });
  return pages;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'EXTRACT') return false;
  const run = async () => {
    if (isListingLocation()) return extractListing(message.limit || 600);
    const payload = {
      dimSpecs: Array.isArray(message.dimSpecs) ? message.dimSpecs : [],
      extraImageUrls: Array.isArray(message.extraImageUrls) ? message.extraImageUrls : [],
      composerPages: [],
    };
    if (!payload.dimSpecs.length || !payload.extraImageUrls.length) {
      payload.composerPages = await fetchComposerPages();
    }
    return extract(payload);
  };
  run()
    .then(sendResponse)
    .catch((err) => sendResponse({ blocked: true, error: String(err && err.message) }));
  return true;
});
