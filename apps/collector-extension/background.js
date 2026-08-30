import { collectorIdentity, isAllowedCollectorApi, normalizeCollectorApi, API_DEFAULT_VERSION, DEFAULT_COLLECTOR_API, resolveStoredCollectorApi } from './jwt.js';

const DEFAULTS = {
  api: DEFAULT_COLLECTOR_API,
  token: '',
  tenant: '',
  crawlAllSkus: false,
  apiHostVersion: 0,
};

let polling = false;

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
  const body = await res.json();
  if (body.code !== 0) throw new Error(body.message || 'API error');
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

function ozonProductPath(tabUrl) {
  try {
    const path = new URL(tabUrl).pathname || '/';
    return path.endsWith('/') ? path : path + '/';
  } catch {
    return '/';
  }
}

function emptyHarvest(error) {
  return { dimSpecs: [], imgUrls: [], fetches: [], error: error || '', pageCount: 0, debug: [], charNames: [], meta: {} };
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
  product = mergeDimSpecs(product, harvest && harvest.dimSpecs);
  if (!product || product.kind === 'listing' || !harvest) {
    return product;
  }
  const meta = harvest.meta && typeof harvest.meta === 'object' ? harvest.meta : {};
  if (meta.brand && !product.brand) product.brand = meta.brand;
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
  return product;
}

function mergeDimSpecs(product, dimSpecs) {
  if (!product || product.kind === 'listing' || !Array.isArray(dimSpecs) || !dimSpecs.length) {
    return product;
  }
  product.specs = Array.isArray(product.specs) ? product.specs : [];
  dimSpecs
    .slice()
    .reverse()
    .forEach((spec) => {
      const name = String((spec && spec.name) || '').trim();
      const value = String((spec && spec.value) || '').trim();
      if (!name || !value) return;
      const idx = product.specs.findIndex((item) => item.name === name);
      if (idx >= 0) product.specs[idx] = { name, value };
      else product.specs.unshift({ name, value });
    });
  return product;
}

async function harvestOzonComposer(tabId, tabUrl) {
  if (!/\/product\//i.test(tabUrl) || isListingUrl(tabUrl)) {
    return emptyHarvest();
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['ozon-harvest.js'],
    });
    const injected = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [ozonProductPath(tabUrl), String(tabUrl).match(/(\d{6,})\/?(?:[?#]|$)/)?.[1] || ''],
        func: async (productPath, pageSku) => {
          try {
            if (typeof window.__aiecomHarvestOzon !== 'function') {
              return { dimSpecs: [], imgUrls: [], fetches: [], error: 'harvest helper missing', pageCount: 0, debug: [], charNames: [], meta: {} };
            }
            const report = await window.__aiecomHarvestOzon(productPath, pageSku);
            if (!report || typeof report !== 'object') {
              return { dimSpecs: [], imgUrls: [], fetches: [], error: 'harvest returned ' + String(report), pageCount: 0, debug: [], charNames: [], meta: {} };
            }
            return JSON.parse(JSON.stringify(report));
          } catch (error) {
            return {
              dimSpecs: [],
              imgUrls: [],
              fetches: [],
              error: String(error && error.message ? error.message : error),
              pageCount: 0,
              debug: [],
              charNames: [],
              meta: {},
            };
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
    limit: Number(limit) > 0 ? Number(limit) : 80,
    dimSpecs: harvest.dimSpecs,
    extraImageUrls: harvest.imgUrls,
  };
  let result;
  try {
    result = await chrome.tabs.sendMessage(tabId, message);
  } catch (_e) {
    /* content script may not be injected yet */
  }
  if (!result) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    result = await chrome.tabs.sendMessage(tabId, message);
  }
  return mergeHarvest(result, harvest);
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
      const extra = await collectUrl(url, 2800);
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
  const tab = await chrome.tabs.create({ url: sourceUrl, active: false });
  try {
    await waitTabComplete(tab.id, 25_000);
    await sleep(waitMs || 2800);
    let product = await extractTab(tab.id);
    if (!isUsableProduct(product)) {
      await sleep(1500);
      product = await extractTab(tab.id);
    }
    return product;
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
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
  const cap = Number(limit) > 0 ? Number(limit) : 36;
  const tab = await chrome.tabs.create({ url: sourceUrl, active: false });
  const seen = {};
  const urls = [];
  try {
    await waitTabComplete(tab.id, 25_000);
    await sleep(2200);

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
    for (let i = 0; i < 6 && urls.length < cap && !(last && last.blocked && urls.length === 0); i++) {
      if (tab.id) {
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            func: () => window.scrollTo(0, Math.max(document.body.scrollHeight || 0, window.scrollY + 1400)),
          })
          .catch(() => undefined);
      }
      await sleep(1300);
      last = await harvest();
    }

    for (let page = 2; page <= 4 && urls.length < cap && !(last && last.blocked && urls.length === 0); page++) {
      const next = new URL(sourceUrl);
      next.searchParams.set('page', String(page));
      await chrome.tabs.update(tab.id, { url: next.toString() });
      await waitTabComplete(tab.id, 25_000);
      await sleep(2200);
      last = await harvest();
      if (tab.id) {
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            func: () => window.scrollTo(0, Math.min(2400, document.body.scrollHeight || 2400)),
          })
          .catch(() => undefined);
      }
      await sleep(1200);
      last = await harvest();
    }

    return {
      kind: 'listing',
      urls: urls.slice(0, cap),
      blocked: Boolean(last && last.blocked && urls.length === 0),
      sourceUrl,
    };
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function pollOnce() {
  const cfg = await settings();
  const item = await api('/collector/tasks/claim?agentKey=' + encodeURIComponent(cfg.agentKey) + '&type=CHROME_EXT');
  if (!item) return 'idle';

  if (/\/product\/mock-/i.test(item.sourceUrl)) {
    await api('/collector/tasks/' + item.id + '/result', {
      method: 'POST',
      body: JSON.stringify({ agentKey: cfg.agentKey, success: false, error: 'Live 拒绝 mock 链接' }),
    });
    return 'skip-mock';
  }

  if (isListingUrl(item.sourceUrl)) {
    const listing = await collectListing(item.sourceUrl, item.listingLimit || 36);
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

async function pollLoop() {
  if (!polling) return;
  try {
    await heartbeat();
    const result = await pollOnce();
    console.log('[aiecom] poll', result);
  } catch (error) {
    console.warn('[aiecom] poll error', error);
  }
  if (polling) setTimeout(pollLoop, 5000);
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
    polling = true;
    chrome.alarms.create('poll', { periodInMinutes: 1 });
    pollLoop()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'STOP') {
    polling = false;
    chrome.alarms.clear('poll');
    sendResponse({ ok: true });
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
