import { collectorIdentity, isAllowedCollectorApi, normalizeCollectorApi, API_DEFAULT_VERSION, DEFAULT_COLLECTOR_API, resolveStoredCollectorApi } from './jwt.js';

const DEFAULTS = {
  api: DEFAULT_COLLECTOR_API,
  token: '',
  tenant: '',
  crawlAllSkus: false,
  sellerBridge: false,
  apiHostVersion: 0,
};

const SELLER_ORIGIN = 'https://seller.ozon.ru';

let polling = false;
let pollBusy = false;
let pollStartedAt = 0;
let pollGeneration = 0;
let sellerTabId = 0;

const CRAWL_TABS_KEY = 'crawlTabIds';
const PRODUCT_COLLECT_MS = 60_000;
const LISTING_COLLECT_MS = 120_000;
const POLL_STUCK_MS = 180_000;

async function persistPolling(value) {
  polling = value;
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ polling: value });
      return;
    }
  } catch {
    /* session storage 在极旧内核可能不可用 */
  }
  await chrome.storage.local.set({ polling: value });
}

async function readPollingFlag() {
  try {
    if (chrome.storage.session) {
      const stored = await chrome.storage.session.get({ polling: false });
      if (stored.polling) return true;
    }
  } catch {
    /* fall through */
  }
  const stored = await chrome.storage.local.get({ polling: false });
  return Boolean(stored.polling);
}

async function settings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const api = resolveStoredCollectorApi(stored.api, stored.apiHostVersion);
  if (api !== stored.api || stored.apiHostVersion !== API_DEFAULT_VERSION) {
    await chrome.storage.local.set({ api, apiHostVersion: API_DEFAULT_VERSION });
    stored.api = api;
    stored.apiHostVersion = API_DEFAULT_VERSION;
  }
  const identity = collectorIdentity(stored.token, stored.tenant);
  return {
    ...stored,
    api,
    tenant: identity.tenantId,
    agentKey: identity.agentKey,
  };
}

async function api(path, options) {
  const cfg = await settings();
  const apiBase = normalizeCollectorApi(cfg.api, DEFAULTS.api);
  if (!isAllowedCollectorApi(apiBase)) {
    throw new Error('API 地址非法，请填写 http(s):// 开头的后台地址');
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + cfg.token,
  };
  if (cfg.tenant) headers['X-Tenant-Id'] = cfg.tenant;
  const res = await fetch(apiBase + path, { ...options, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('HTTP ' + res.status);
  }
  if (!res.ok || body.code !== 0) throw new Error(body.message || 'HTTP ' + res.status);
  return body.data;
}

function isOzonHttpsUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && /^(www\.)?ozon\.ru$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isSellerHttpsUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'seller.ozon.ru';
  } catch {
    return false;
  }
}

/** 卖家接口必须同源调用才带 Cookie，所以复用（必要时新开）一个后台 seller 标签页 */
async function ensureSellerTab() {
  if (sellerTabId) {
    const cached = await chrome.tabs.get(sellerTabId).catch(() => null);
    if (cached && isSellerHttpsUrl(String(cached.url || ''))) return sellerTabId;
    sellerTabId = 0;
  }
  const opened = await chrome.tabs.query({ url: SELLER_ORIGIN + '/*' });
  const found = opened.find((tab) => tab.id && isSellerHttpsUrl(String(tab.url || '')));
  if (found) {
    sellerTabId = found.id;
    return sellerTabId;
  }
  const created = await chrome.tabs.create({ url: SELLER_ORIGIN + '/', active: false });
  sellerTabId = created.id;
  await waitTabComplete(sellerTabId, 30_000);
  return sellerTabId;
}

async function querySellerInsights(skus) {
  const cfg = await settings();
  if (!cfg.sellerBridge) return {};
  const wanted = (Array.isArray(skus) ? skus : []).map((sku) => String(sku || '')).filter((sku) => /^\d{6,}$/.test(sku));
  if (!wanted.length) return {};
  const message = { type: 'SELLER_QUERY', skus: wanted };
  let payload;
  try {
    const tabId = await ensureSellerTab();
    try {
      payload = await withTimeout(chrome.tabs.sendMessage(tabId, message), 35_000, '卖家后台查询超时');
    } catch (_e) {
      /* 内容脚本可能还没注入（标签页刚开或插件刚重载） */
    }
    if (!payload) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['seller-bridge.js'] });
      payload = await withTimeout(chrome.tabs.sendMessage(tabId, message), 35_000, '卖家后台查询超时');
    }
  } catch (error) {
    payload = { error: String((error && error.message) || error) };
  }
  const items = payload && payload.items && typeof payload.items === 'object' ? payload.items : {};
  const sample = items[wanted[0]] || items[Object.keys(items)[0]] || {};
  await chrome.storage.local.set({
    lastSellerBridge: {
      at: Date.now(),
      asked: wanted.length,
      hits: Object.keys(items).length,
      error: (payload && payload.error) || '',
      errors: (payload && payload.errors) || {},
      rawKeys: Array.isArray(sample.rawKeys) ? sample.rawKeys : [],
      hasWeight: sample.weight != null,
      hasDimension: Boolean(sample.dimension || (sample.depth && sample.width && sample.height)),
      volume: sample.volume || null,
    },
  });
  return items;
}

function sellerWarehouseType(insight) {
  const fbo = Number(insight.fboStock) || 0;
  const fbs = Number(insight.fbsStock) || 0;
  if (fbo > 0 && fbs > 0) return 'MIXED';
  if (fbo > 0) return 'FBO';
  if (fbs > 0) return 'FBS';
  return '';
}

/** 品牌/类目只补缺；销量、库存、分仓以卖家后台为准（商品页常把评价数当成销量、有价就写库存 1） */
function mergeSellerInsight(product, insight) {
  if (!product || product.kind === 'listing' || !insight || typeof insight !== 'object') {
    return product;
  }
  if (insight.brand && !product.brand) product.brand = insight.brand;
  if (insight.category && !product.categoryPath) product.categoryPath = insight.category;
  if (insight.salesCount != null) product.salesCount = insight.salesCount;
  if (insight.fboStock != null) product.fboStock = insight.fboStock;
  if (insight.fbsStock != null) product.fbsStock = insight.fbsStock;
  if (insight.stock != null) product.stock = insight.stock;
  const warehouse = sellerWarehouseType(insight) || fulfillmentWarehouse(insight.fulfillment);
  if (warehouse && !product.warehouseType) product.warehouseType = warehouse;
  const specs = [];
  if (insight.article) specs.push({ name: 'Артикул производителя', value: insight.article });
  if (insight.sellerName) specs.push({ name: 'Продавец', value: insight.sellerName });
  if (insight.volume) specs.push({ name: 'Объем (Ozon аналитика)', value: String(insight.volume) });
  if (insight.avgDeliveryDays) specs.push({ name: 'Срок доставки', value: String(insight.avgDeliveryDays) + ' дн.' });
  const dimSpecs = sellerLogisticsSpecs(insight);
  return mergeDimSpecs(product, specs.concat(dimSpecs));
}

function fulfillmentWarehouse(raw) {
  const text = String(raw || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (/\bfbo\b/.test(text) || /склад\s+ozon|со склада ozon|ozon склад/.test(text)) return 'FBO';
  if (/\bfbs\b/.test(text) || /склад\s+продавц|со склада продавц/.test(text)) return 'FBS';
  return '';
}

function sellerLogisticsSpecs(insight) {
  const specs = [];
  const parsed = parseSellerDimension(insight && insight.dimension);
  const depth = Number(insight && insight.depth) || (parsed && parsed.depth) || 0;
  const width = Number(insight && insight.width) || (parsed && parsed.width) || 0;
  const height = Number(insight && insight.height) || (parsed && parsed.height) || 0;
  if (depth > 0 && width > 0 && height > 0) {
    specs.push(
      { name: 'Длина упаковки, мм', value: String(Math.round(depth)) },
      { name: 'Ширина упаковки, мм', value: String(Math.round(width)) },
      { name: 'Высота упаковки, мм', value: String(Math.round(height)) },
    );
  } else if (insight && insight.dimension) {
    specs.push({ name: 'dimension', value: String(insight.dimension) });
  }
  const weight = Number(insight && insight.weight);
  if (Number.isFinite(weight) && weight > 0) {
    const grams = weight > 0 && weight < 80 && weight % 1 !== 0 ? Math.round(weight * 1000) : Math.round(weight);
    if (grams > 0 && grams < 100000) specs.push({ name: 'Вес брутто, г', value: String(grams) });
  }
  return specs;
}

function parseSellerDimension(raw) {
  const text = String(raw || '').replace(/,/g, '.').replace(/\s+/g, '').trim();
  const match = text.match(/^(\d+(?:\.\d+)?)[xх×*](\d+(?:\.\d+)?)(?:[xх×*](\d+(?:\.\d+)?))?(?:мм|mm|см|cm)?$/i);
  if (!match) return null;
  const asCm = /см|cm/i.test(String(raw || '')) && !/мм|mm/i.test(String(raw || ''));
  const toMm = (value) => (asCm ? value * 10 : value);
  const depth = toMm(Number(match[1]));
  const width = toMm(Number(match[2]));
  const height = match[3] ? toMm(Number(match[3])) : 0;
  if (![depth, width, height].every((item) => Number.isFinite(item) && item > 0 && item < 5000)) return null;
  return { depth, width, height };
}

function isTrustedExtensionSender(sender) {
  if (sender.tab) {
    return false;
  }
  const prefix = chrome.runtime.getURL('');
  return typeof sender.url === 'string' && sender.url.startsWith(prefix);
}

async function heartbeat() {
  const cfg = await settings();
  return api('/collector/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      agentKey: cfg.agentKey,
      type: 'CHROME_EXT',
      name: 'Chrome MV3',
      sessionValid: true,
    }),
  });
}

function waitTabComplete(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error('标签页已关闭');
      if (tab.status === 'complete' && /ozon\.ru/i.test(String(tab.url || ''))) {
        return tab;
      }
      await sleep(250);
    }
    throw new Error('页面加载超时');
  })();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  const budget = Math.max(1, Math.floor(Number(ms) || 0));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), budget);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function shouldForceUnlockPoll(input) {
  if (!input.busy || input.startedAt <= 0) return false;
  return input.now - input.startedAt >= input.stuckMs;
}

function isNoReceiverError(error) {
  return /Receiving end does not exist|Could not establish connection/i.test(String((error && error.message) || error));
}

async function readCrawlTabIds() {
  try {
    if (chrome.storage.session) {
      const stored = await chrome.storage.session.get({ [CRAWL_TABS_KEY]: [] });
      if (Array.isArray(stored[CRAWL_TABS_KEY])) return stored[CRAWL_TABS_KEY];
    }
  } catch {
    /* session storage 在极旧内核可能不可用 */
  }
  const stored = await chrome.storage.local.get({ [CRAWL_TABS_KEY]: [] });
  return Array.isArray(stored[CRAWL_TABS_KEY]) ? stored[CRAWL_TABS_KEY] : [];
}

async function writeCrawlTabIds(ids) {
  const unique = [...new Set((ids || []).filter((id) => Number(id) > 0))];
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ [CRAWL_TABS_KEY]: unique });
      return;
    }
  } catch {
    /* fall through */
  }
  await chrome.storage.local.set({ [CRAWL_TABS_KEY]: unique });
}

async function rememberCrawlTab(tabId) {
  if (!tabId) return;
  const ids = await readCrawlTabIds();
  if (!ids.includes(tabId)) ids.push(tabId);
  await writeCrawlTabIds(ids);
}

async function forgetCrawlTab(tabId) {
  if (!tabId) return;
  const ids = await readCrawlTabIds();
  await writeCrawlTabIds(ids.filter((id) => id !== tabId));
}

async function sweepCrawlTabs() {
  const ids = await readCrawlTabIds();
  await Promise.all(ids.map((id) => chrome.tabs.remove(id).catch(() => undefined)));
  await writeCrawlTabIds([]);
}

async function openCrawlTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error('无法打开采集标签页');
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
  await rememberCrawlTab(tab.id);
  return tab;
}

async function closeCrawlTab(tabId) {
  if (!tabId) return;
  await chrome.tabs.remove(tabId).catch(() => undefined);
  await forgetCrawlTab(tabId);
}

function ozonProductPath(tabUrl) {
  try {
    const path = new URL(tabUrl).pathname || '/';
    return path.endsWith('/') ? path : path + '/';
  } catch {
    return '/';
  }
}

function emptyHarvest(error) {
  return {
    dimSpecs: [],
    queuedWidgets: [],
    attrs: {},
    imgUrls: [],
    fetches: [],
    error: error || '',
    pageCount: 0,
    debug: [],
    charNames: [],
    meta: {},
  };
}

function isProductGalleryUrl(url) {
  const value = String(url || '');
  if (!value) return false;
  if (
    /\/cms\/|\/graphics\/|\/icons?\/|\/static\/|\/promo\/|\/bonus\/|\/marketing-api\/|\/banners?\/|searchteam-cdn|favicon|sprite|logo/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/(?:^|[/-])(?:logo|icon|badge|banner|sprite|avatar|favicon|payment|flame)(?:[/-]|\.|$)/i.test(value)) {
    return false;
  }
  return /\/s3\/(?:multimedia|rp-photo)/i.test(value) || /\/multimedia(?:-\w+)?\//i.test(value);
}

function mergeHarvest(product, harvest) {
  const meta = harvest && harvest.meta && typeof harvest.meta === 'object' ? harvest.meta : {};
  const keepOverlayPackaging = Boolean(product && product.seerfarOverlay) && !meta.seerfar;
  product = mergeDimSpecs(product, harvest && harvest.dimSpecs, { keepOverlayPackaging });
  if (!product || product.kind === 'listing' || !harvest) {
    return product;
  }
  if (meta.brand && !product.brand) product.brand = meta.brand;
  if (meta.stock != null && Number(meta.stock) > 0) {
    const pageStock = Number(product.stock) || 0;
    if (pageStock <= 1 || Number(meta.stock) > pageStock) product.stock = Number(meta.stock);
  }
  if (meta.salesCount != null && Number(meta.salesCount) > 0 && !(Number(product.salesCount) > 0)) {
    product.salesCount = Number(meta.salesCount);
  }
  if (meta.warehouseType && !product.warehouseType) product.warehouseType = meta.warehouseType;
  if (meta.description && (!product.description || product.description.length < String(meta.description).length)) {
    product.description = meta.description;
  }
  if (meta.rating && !product.rating) product.rating = meta.rating;
  if (meta.reviewCount && !product.reviewCount) product.reviewCount = meta.reviewCount;
  if (meta.categoryPath && !product.categoryPath) product.categoryPath = meta.categoryPath;
  if (meta.originalPrice && !product.originalPrice) product.originalPrice = meta.originalPrice;
  if (meta.discountPrice && !product.discountPrice) product.discountPrice = meta.discountPrice;
  if (meta.price && (!product.price || product.price <= 0)) product.price = meta.price;
  if (Array.isArray(meta.videoUrls) && meta.videoUrls.length) {
    product.videoUrls = (product.videoUrls || [])
      .concat(meta.videoUrls)
      .filter((url, index, arr) => url && arr.indexOf(url) === index)
      .slice(0, 8);
  }
  const harvested = (Array.isArray(harvest.imgUrls) ? harvest.imgUrls : []).filter(isProductGalleryUrl);
  const existing = (product.imageUrls || []).filter(isProductGalleryUrl);
  const seen = {};
  product.imageUrls = (harvested.length ? harvested.concat(existing) : existing).filter((url) => {
    if (!url || seen[url]) return false;
    seen[url] = true;
    return true;
  }).slice(0, 30);
  if (product.imageUrls[0] && (!product.mainImageUrl || !isProductGalleryUrl(product.mainImageUrl))) {
    product.mainImageUrl = product.imageUrls[0];
  }
  const deliverySpecs = [];
  if (meta.deliveryWarehouse) deliverySpecs.push({ name: 'Склад отгрузки', value: String(meta.deliveryWarehouse) });
  if (meta.deliveryText) deliverySpecs.push({ name: 'Срок доставки', value: String(meta.deliveryText) });
  const fromDelivery = fulfillmentWarehouse(String(meta.deliveryWarehouse || '') + ' ' + String(meta.deliveryText || ''));
  if (fromDelivery && !product.warehouseType) product.warehouseType = fromDelivery;
  return mergeDimSpecs(product, deliverySpecs, { keepOverlayPackaging });
}

function mergeDimSpecs(product, dimSpecs, opts) {
  if (!product || product.kind === 'listing' || !Array.isArray(dimSpecs) || !dimSpecs.length) {
    return product;
  }
  const keepOverlayPackaging = Boolean(opts && opts.keepOverlayPackaging);
  product.specs = Array.isArray(product.specs) ? product.specs : [];
  dimSpecs
    .slice()
    .reverse()
    .forEach((spec) => {
      const name = String((spec && spec.name) || '').trim();
      const value = String((spec && spec.value) || '').trim();
      if (!name || !value) return;
      const idx = product.specs.findIndex((item) => item.name === name);
      if (idx >= 0) {
        if (keepOverlayPackaging && /упаковк|брутто|^dimension$|склад отгрузки/i.test(name)) return;
        product.specs[idx] = { name, value };
      } else product.specs.unshift({ name, value });
    });
  return product;
}

async function harvestOzonComposer(tabId, tabUrl) {
  if (!/\/product\//i.test(tabUrl) || isListingUrl(tabUrl)) {
    return emptyHarvest();
  }
  try {
    await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: ['seerfar-overlay.js', 'ozon-harvest.js'],
      }),
      15_000,
      'harvest inject timeout',
    );
    const injected = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [ozonProductPath(tabUrl), String(tabUrl).match(/(\d{6,})\/?(?:[?#]|$)/)?.[1] || ''],
        func: async (productPath, pageSku) => {
          const fail = (error) => ({
            dimSpecs: [],
            queuedWidgets: [],
            attrs: {},
            imgUrls: [],
            fetches: [],
            error,
            pageCount: 0,
            debug: [],
            charNames: [],
            meta: {},
          });
          try {
            if (typeof window.__aiecomHarvestOzon !== 'function') {
              return fail('harvest helper missing');
            }
            const report = await window.__aiecomHarvestOzon(productPath, pageSku);
            if (!report || typeof report !== 'object') {
              return fail('harvest returned ' + String(report));
            }
            return JSON.parse(JSON.stringify(report));
          } catch (error) {
            return fail(String(error && error.message ? error.message : error));
          }
        },
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('composer timeout')), 45000);
      }),
    ]);
    const result = injected && injected[0] && injected[0].result;
    if (injected && injected[0] && injected[0].error) {
      return emptyHarvest(String(injected[0].error.message || injected[0].error));
    }
    if (result) {
      return {
        dimSpecs: Array.isArray(result.dimSpecs) ? result.dimSpecs.filter((item) => item && item.name && item.value) : [],
        queuedWidgets: Array.isArray(result.queuedWidgets) ? result.queuedWidgets.slice(0, 24) : [],
        attrs: result.attrs && typeof result.attrs === 'object' ? result.attrs : {},
        imgUrls: Array.isArray(result.imgUrls) ? result.imgUrls.filter(Boolean) : [],
        fetches: Array.isArray(result.fetches) ? result.fetches : [],
        error: String(result.error || ''),
        pageCount: Number(result.pageCount) || 0,
        debug: Array.isArray(result.debug) ? result.debug.slice(0, 12) : [],
        charNames: Array.isArray(result.charNames) ? result.charNames.slice(0, 80) : [],
        meta: result.meta && typeof result.meta === 'object' ? result.meta : {},
      };
    }
    return emptyHarvest(
      'empty harvest result: frames=' + (Array.isArray(injected) ? injected.length : typeof injected),
    );
  } catch (error) {
    return emptyHarvest(String(error && error.message ? error.message : error));
  }
}

async function extractTab(tabId, limit) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isOzonHttpsUrl(String(tab.url || ''))) {
    throw new Error('仅允许采集 ozon.ru 页面');
  }
  const harvest = await harvestOzonComposer(tabId, String(tab.url || ''));
  await chrome.storage.local.set({
    lastHarvest: {
      at: Date.now(),
      skuId: String(tab.url || '').match(/(\d{6,})\/?(?:[?#]|$)/)?.[1] || '',
      dimSpecs: harvest.dimSpecs,
      queuedWidgets: harvest.queuedWidgets || [],
      attrs: harvest.attrs || {},
      fetches: harvest.fetches,
      pageCount: harvest.pageCount,
      error: harvest.error,
      debug: harvest.debug || [],
      charNames: harvest.charNames || [],
      meta: harvest.meta || {},
      imgCount: Array.isArray(harvest.imgUrls) ? harvest.imgUrls.length : 0,
    },
  });
  const message = {
    type: 'EXTRACT',
    limit: Number(limit) > 0 ? Number(limit) : 600,
    dimSpecs: harvest.dimSpecs,
    extraImageUrls: harvest.imgUrls,
  };
  const extractMs = Number(limit) > 0 ? 110_000 : 25_000;
  let result;
  try {
    result = await withTimeout(chrome.tabs.sendMessage(tabId, message), extractMs, '页面提取超时');
  } catch (error) {
    if (!isNoReceiverError(error)) throw error;
  }
  if (!result) {
    await withTimeout(
      chrome.scripting.executeScript({ target: { tabId }, files: ['seerfar-overlay.js', 'content.js'] }),
      15_000,
      '注入内容脚本超时',
    );
    result = await withTimeout(chrome.tabs.sendMessage(tabId, message), extractMs, '页面提取超时');
  }
  const product = mergeHarvest(result, harvest);
  const sku = String(tab.url || '').match(/(\d{6,})\/?(?:[?#]|$)/)?.[1] || '';
  if (product && product.kind !== 'listing' && sku) {
    const insights = await querySellerInsights([sku]).catch(() => ({}));
    mergeSellerInsight(product, insights[sku]);
  }
  return product;
}

function isUsableProduct(product) {
  if (!product || product.blocked) return false;
  if (!product.skuId || !product.name || !product.sourceUrl) return false;
  if (/^ozon\.?$/i.test(String(product.name).trim())) return false;
  if (/验证码|captcha|доступ ограничен|cloudflare/i.test(product.name)) return false;
  return true;
}

function toIngestProduct(product, crawlAllSkus) {
  return {
    skuId: String(product.skuId),
    name: String(product.name),
    sourceUrl: String(product.sourceUrl),
    mainImageUrl: product.mainImageUrl || undefined,
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
    price: Number(product.price) || 0,
    currency: product.currency || 'RUB',
    stock: Number(product.stock) || 0,
    fboStock: product.fboStock,
    fbsStock: product.fbsStock,
    warehouseType: product.warehouseType,
    specs: Array.isArray(product.specs) ? product.specs : [],
    categoryPath: product.categoryPath,
    rating: product.rating,
    salesCount: Number(product.salesCount) || 0,
    description: product.description || undefined,
    brand: product.brand || undefined,
    originalPrice: product.originalPrice || undefined,
    discountPrice: product.discountPrice || undefined,
    reviewCount: Number(product.reviewCount) || 0,
    videoUrls: Array.isArray(product.videoUrls) ? product.videoUrls : [],
    variants: Array.isArray(product.variants)
      ? crawlAllSkus
        ? product.variants
        : product.variants.map((dim) => ({
            ...dim,
            values: (dim.values || []).map((value) => ({
              ...value,
              skuId: value.skuId && String(value.skuId) === String(product.skuId) ? value.skuId : undefined,
              sourceUrl: value.skuId && String(value.skuId) !== String(product.skuId) ? undefined : value.sourceUrl,
            })),
          }))
      : [],
    skuOptions: crawlAllSkus ? fillSkuOptions(product) : [toSkuOption(product, product.variants || [])],
  };
}

function normalizeDimName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
    .trim();
}

function optionsForSku(skuId, name, sourceUrl, variants) {
  const options = {};
  (variants || []).forEach((dim) => {
    const dimName = normalizeDimName(dim.name);
    if (!dimName) return;
    const match =
      (dim.values || []).find((item) => item.skuId && item.skuId === String(skuId)) ||
      (dim.values || []).find((item) => String(item.sourceUrl || '').includes(String(skuId))) ||
      (dim.values || []).find((item) => item.value && String(name || '').includes(item.value));
    if (match && match.value) options[dimName] = match.value;
  });
  if (!Object.keys(options).some((key) => /вес/i.test(key))) {
    if (/\b1(?:[.,]0)?\s*кг|\b1-kg\b|\b1000[\s-]*g\b/i.test(String(name || ''))) options['Вес товара, г'] = '1000';
    else {
      const grams = String(name || '').match(/(\d{2,4})\s*г(?![а-яё])/i) || String(name || '').match(/(\d{2,4})-g\b/i);
      if (grams) options['Вес товара, г'] = grams[1];
    }
  }
  return options;
}

function toSkuOption(product, variants) {
  return {
    skuId: String(product.skuId),
    name: product.name,
    sourceUrl: String(product.sourceUrl || '').split('?')[0],
    price: Number(product.price) || 0,
    originalPrice: product.originalPrice,
    discountPrice: product.discountPrice,
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
    options: optionsForSku(product.skuId, product.name, product.sourceUrl, variants || product.variants),
  };
}

function fillSkuOptions(product) {
  const variants = product.variants || [];
  const list = (Array.isArray(product.skuOptions) ? product.skuOptions : []).slice();
  const seen = new Set(list.map((item) => String(item.skuId || '')));
  if (product.skuId && !seen.has(String(product.skuId))) {
    list.unshift(toSkuOption(product, variants));
    seen.add(String(product.skuId));
  }
  variants.forEach((dim) => {
    (dim.values || []).forEach((value) => {
      const skuId = String(value.skuId || '');
      if (!skuId || seen.has(skuId)) return;
      seen.add(skuId);
      list.push({
        skuId,
        name: product.name + ' / ' + value.value,
        sourceUrl: String(value.sourceUrl || product.sourceUrl || '').split('?')[0],
        price: Number(value.price || product.price) || 0,
        imageUrls: Array.isArray(value.imageUrls) ? value.imageUrls : [],
        options: optionsForSku(skuId, product.name + ' ' + value.value, value.sourceUrl, variants),
      });
    });
  });
  return list;
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

function isSpecAspectName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n || /покупают вместе|похожие|рекоменд|смотрели|хиты продаж|вам понрав|другие товар|популярн/i.test(n)) return false;
  return /вес|вкус|цвет|размер|объ[её]м|фасовка|количест|рост|обхват|длин|ширин|высот|модель|комплект|штук|название|аромат|плотность|состав|покрой|рукав|вырез|застежк|color|size|qty|variant/i.test(
    n,
  );
}

function siblingUrls(product) {
  const urls = [];
  (product.variants || []).forEach((dim) => {
    if (!isSpecAspectName(dim.name)) return;
    (dim.values || []).forEach((value) => {
      if (value.sourceUrl) urls.push(value.sourceUrl);
      else if (value.skuId) urls.push('https://www.ozon.ru/product/' + value.skuId + '/');
    });
  });
  return urls;
}

function mergeVariantMaps(target, extra) {
  extra.variants = extra.variants || [];
  target.variants = target.variants || [];
  extra.variants.forEach((dim) => {
    if (!isSpecAspectName(dim.name)) return;
    const dimName = normalizeDimName(dim.name);
    let found = target.variants.find((item) => normalizeDimName(item.name) === dimName);
    if (!found) {
      found = { name: dimName, values: [] };
      target.variants.push(found);
    } else {
      found.name = dimName;
    }
    (dim.values || []).forEach((value) => {
      const existing = found.values.find((item) => item.value === value.value);
      if (!existing) found.values.push({ ...value });
      else {
        existing.skuId = existing.skuId || value.skuId;
        existing.sourceUrl = existing.sourceUrl || value.sourceUrl;
        existing.selected = existing.selected || value.selected;
        existing.price = existing.price || value.price;
        if ((!existing.imageUrls || !existing.imageUrls.length) && value.imageUrls && value.imageUrls.length) {
          existing.imageUrls = value.imageUrls;
        }
      }
    });
  });
}

async function enrichProductVariants(product) {
  product.variants = product.variants || [];
  const bySku = new Map();
  bySku.set(String(product.skuId), product);
  const seenUrl = new Set([String(product.sourceUrl || '').split('?')[0]]);
  const queue = [];
  siblingUrls(product).forEach((url) => {
    const path = String(url).split('?')[0];
    if (!path || seenUrl.has(path)) return;
    seenUrl.add(path);
    queue.push(url);
  });

  while (queue.length && bySku.size < 24) {
    const url = queue.shift();
    try {
      const extra = await collectUrl(url, 1200);
      if (!isUsableProduct(extra)) continue;
      extra.sourceUrl = String(extra.sourceUrl || url).split('?')[0];
      extra.variants = extra.variants || [];
      extra.variants = extra.variants.filter((dim) => isSpecAspectName(dim.name));
      const seedFamily = listingSlugFamily(product.sourceUrl || '');
      const extraFamily = listingSlugFamily(extra.sourceUrl || url);
      if (seedFamily.split('-').length >= 2 && extraFamily.split('-').length >= 2 && seedFamily !== extraFamily) continue;
      const sku = String(extra.skuId);
      if (!bySku.has(sku)) bySku.set(sku, extra);
      mergeVariantMaps(product, extra);
      siblingUrls(extra).forEach((next) => {
        const path = String(next).split('?')[0];
        if (!path || seenUrl.has(path)) return;
        seenUrl.add(path);
        queue.push(next);
      });
    } catch (_e) {
      /* sibling page may be blocked; keep discovering others */
    }
  }

  product.skuOptions = fillSkuOptions({
    ...product,
    skuOptions: [...bySku.values()].map((item) => toSkuOption(item, product.variants)),
  });
  return product;
}

async function collectUrl(sourceUrl, waitMs) {
  if (!isOzonHttpsUrl(sourceUrl)) {
    throw new Error('仅允许打开 ozon.ru 商品页');
  }
  const tab = await openCrawlTab(sourceUrl);
  try {
    return await withTimeout(
      (async () => {
        await waitTabComplete(tab.id, 25_000);
        await sleep(waitMs || 1200);
        let product = await extractTab(tab.id);
        if (!isUsableProduct(product)) {
          await sleep(600);
          product = await extractTab(tab.id);
        }
        return product;
      })(),
      PRODUCT_COLLECT_MS,
      '商品页采集超时',
    );
  } finally {
    await closeCrawlTab(tab.id);
  }
}

function isListingUrl(url) {
  const raw = String(url || '');
  if (/ozon\.ru\/product\//i.test(raw)) return false;
  return /ozon\.ru\/(?:category|search|highlight)\//i.test(raw) || /ozon\.ru\/search\?/i.test(raw);
}

async function collectListing(sourceUrl, limit) {
  if (!isOzonHttpsUrl(sourceUrl)) {
    throw new Error('仅允许打开 ozon.ru 品类/搜索页');
  }
  const cap = Number(limit) > 0 ? Number(limit) : 600;
  const tab = await openCrawlTab(sourceUrl);
  const seen = {};
  const urls = [];
  try {
    return await withTimeout(
      (async () => {
        await waitTabComplete(tab.id, 25_000);
        await sleep(1000);

        const harvest = async () => {
          const data = await extractTab(tab.id, cap);
          for (const url of (data && Array.isArray(data.urls) ? data.urls : [])) {
            const sku = String(url || '').match(/(\d{6,})\/?$/)?.[1];
            if (!sku || seen[sku] || /mock-/i.test(url)) continue;
            seen[sku] = true;
            urls.push(url);
          }
          return data;
        };

        let last = await harvest();
        if (urls.length === 0 && !(last && last.blocked)) {
          await sleep(600);
          last = await harvest();
        }

        return {
          kind: 'listing',
          urls: urls.slice(0, cap),
          blocked: Boolean(last && last.blocked && urls.length === 0),
          sourceUrl,
        };
      })(),
      LISTING_COLLECT_MS,
      '品类页采集超时',
    );
  } catch (error) {
    if (urls.length) {
      return { kind: 'listing', urls: urls.slice(0, cap), blocked: false, sourceUrl };
    }
    throw error;
  } finally {
    await closeCrawlTab(tab.id);
  }
}

async function claimNext(cfg) {
  return api('/collector/tasks/claim?agentKey=' + encodeURIComponent(cfg.agentKey) + '&type=CHROME_EXT');
}

async function failClaimed(cfg, item, error) {
  const text = error instanceof Error ? error.message : String(error || '采集失败');
  const captcha = /验证码|captcha|challenge/i.test(text);
  await api('/collector/tasks/' + item.id + '/result', {
    method: 'POST',
    body: JSON.stringify({
      agentKey: cfg.agentKey,
      success: false,
      error: text,
      failCode: captcha ? 'CAPTCHA_DETECTED' : 'COLLECT_FAILED',
    }),
  });
  return captcha ? 'fail-captcha' : 'fail';
}

async function processClaimed(cfg, item) {
  try {
    return await processClaimedUnsafe(cfg, item);
  } catch (error) {
    try {
      return await failClaimed(cfg, item, error);
    } catch {
      return 'fail';
    }
  }
}

async function processClaimedUnsafe(cfg, item) {
  if (/\/product\/mock-/i.test(item.sourceUrl)) {
    await api('/collector/tasks/' + item.id + '/result', {
      method: 'POST',
      body: JSON.stringify({ agentKey: cfg.agentKey, success: false, error: 'Live 拒绝 mock 链接' }),
    });
    return 'skip-mock';
  }

  if (isListingUrl(item.sourceUrl)) {
    const listing = await collectListing(item.sourceUrl, item.listingLimit || 600);
    if (listing && listing.blocked) {
      await api('/collector/tasks/' + item.id + '/result', {
        method: 'POST',
        body: JSON.stringify({
          agentKey: cfg.agentKey,
          success: false,
          error: '品类页被验证码拦截，请先在 Chrome 打开 ozon.ru 完成验证后再轮询',
        }),
      });
      return 'fail-captcha';
    }
    const urls = listing && Array.isArray(listing.urls) ? listing.urls : [];
    if (!urls.length) {
      await api('/collector/tasks/' + item.id + '/result', {
        method: 'POST',
        body: JSON.stringify({ agentKey: cfg.agentKey, success: false, error: '品类页未解析到商品链接' }),
      });
      return 'fail-listing';
    }
    await api('/collector/tasks/' + item.id + '/listing', {
      method: 'POST',
      body: JSON.stringify({ agentKey: cfg.agentKey, urls }),
    });
    return 'listing:' + urls.length;
  }

  const product = await collectUrl(item.sourceUrl);
  if (!isUsableProduct(product)) {
    await api('/collector/tasks/' + item.id + '/result', {
      method: 'POST',
      body: JSON.stringify({
        agentKey: cfg.agentKey,
        success: false,
        error: (product && product.blocked ? '页面被验证码拦截，请先在 Chrome 完成验证后再轮询' : '页面未解析到真实商品'),
        failCode: product && product.blocked ? 'CAPTCHA_DETECTED' : 'COLLECT_FAILED',
      }),
    });
    return 'fail';
  }

  await api('/collector/tasks/' + item.id + '/result', {
    method: 'POST',
    body: JSON.stringify({ agentKey: cfg.agentKey, success: true, product: toIngestProduct(product, false) }),
  });
  return 'ok:' + product.skuId;
}

async function pollOnce() {
  if (pollBusy) {
    if (!shouldForceUnlockPoll({ busy: true, startedAt: pollStartedAt, now: Date.now(), stuckMs: POLL_STUCK_MS })) {
      return 'busy';
    }
    console.warn('[aiecom] poll stuck, closing leftover crawl tabs');
    pollGeneration += 1;
    await sweepCrawlTabs();
    pollBusy = false;
  }
  const gen = ++pollGeneration;
  pollBusy = true;
  pollStartedAt = Date.now();
  try {
    return await pollOnceUnsafe();
  } finally {
    if (gen === pollGeneration) {
      pollBusy = false;
      pollStartedAt = 0;
    }
  }
}

async function pollOnceUnsafe() {
  const cfg = await settings();
  const first = await claimNext(cfg);
  if (!first) return 'idle';
  if (isListingUrl(first.sourceUrl) || /\/product\/mock-/i.test(first.sourceUrl)) {
    return processClaimed(cfg, first);
  }
  const second = await claimNext(cfg);
  if (second && !isListingUrl(second.sourceUrl) && !/\/product\/mock-/i.test(second.sourceUrl)) {
    const results = await Promise.all([processClaimed(cfg, first), processClaimed(cfg, second)]);
    return results.join(',');
  }
  const firstResult = await processClaimed(cfg, first);
  if (second) {
    return firstResult + ',' + (await processClaimed(cfg, second));
  }
  return firstResult;
}

async function pollLoop() {
  if (!polling) return;
  let result = 'idle';
  try {
    await heartbeat();
    result = await pollOnce();
    console.log('[aiecom] poll', result);
  } catch (error) {
    console.warn('[aiecom] poll error', error);
  }
  if (polling) setTimeout(pollLoop, result === 'idle' ? 2000 : 250);
}

async function ingestCurrentTab(tabId) {
  const extracted = await extractTab(tabId);
  if (extracted && extracted.kind === 'listing') {
    throw new Error('当前是品类/搜索页。请用「开始轮询」领取品类任务，或打开具体商品页再点采集本页');
  }
  if (!isUsableProduct(extracted)) {
    throw new Error(extracted && extracted.blocked ? '当前页被验证码拦截，请先完成验证' : '当前页未解析到真实商品');
  }
  const product = extracted;
  const data = await api('/collector/ingest', {
    method: 'POST',
    body: JSON.stringify({
      ...toIngestProduct(product, false),
      crawlAllSkus: false,
    }),
  });
  const harvest = await chrome.storage.local.get({ lastHarvest: null });
  const harvestInfo = harvest.lastHarvest || null;
  await chrome.storage.local.set({
    lastIngest: {
      at: Date.now(),
      ok: true,
      skuId: product.skuId,
      data,
      harvest: harvestInfo,
    },
  });
  return { data, harvest: harvestInfo };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedExtensionSender(sender)) {
    sendResponse({ ok: false, error: '拒绝未授权来源' });
    return false;
  }
  if (message.type === 'START') {
    persistPolling(true)
      .then(() => sweepCrawlTabs())
      .then(() => {
        chrome.alarms.create('poll', { periodInMinutes: 1 });
        return pollLoop();
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'STOP') {
    persistPolling(false)
      .then(() => chrome.alarms.clear('poll'))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'INGEST_TAB') {
    ingestCurrentTab(message.tabId)
      .then((payload) => sendResponse({ ok: true, data: payload.data, harvest: payload.harvest }))
      .catch((error) => {
        chrome.storage.local.get({ lastHarvest: null }).then((stored) => {
          chrome.storage.local.set({
            lastIngest: { at: Date.now(), ok: false, error: error.message, harvest: stored.lastHarvest || null },
          });
          sendResponse({ ok: false, error: error.message, harvest: stored.lastHarvest || null });
        });
      });
    return true;
  }
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll' && polling) {
    pollOnce().catch((error) => console.warn(error));
  }
});

readPollingFlag().then(async (active) => {
  await sweepCrawlTabs();
  if (!active) return;
  polling = true;
  chrome.alarms.create('poll', { periodInMinutes: 1 });
  pollLoop();
});
