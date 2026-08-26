import { collectorIdentity } from './jwt.js';

const DEFAULTS = {
  api: 'http://localhost:3000/api/v1',
  token: '',
  tenant: '',
  crawlAllSkus: false,
};

let polling = false;

async function settings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const identity = collectorIdentity(stored.token, stored.tenant);
  return {
    ...stored,
    tenant: identity.tenantId,
    agentKey: identity.agentKey,
  };
}

async function api(path, options) {
  const cfg = await settings();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + cfg.token,
  };
  if (cfg.tenant) headers['X-Tenant-Id'] = cfg.tenant;
  const res = await fetch(cfg.api + path, { ...options, headers });
  const body = await res.json();
  if (body.code !== 0) throw new Error(body.message || 'API error');
  return body.data;
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

async function extractTab(tabId, limit) {
  const message = { type: 'EXTRACT', limit: Number(limit) > 0 ? Number(limit) : 80 };
  try {
    const result = await chrome.tabs.sendMessage(tabId, message);
    if (result) return result;
  } catch (_e) {
    /* content script may not be injected yet */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  return chrome.tabs.sendMessage(tabId, message);
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

  const product = item.crawlAllSkus
    ? await enrichProductVariants(await collectUrl(item.sourceUrl))
    : await collectUrl(item.sourceUrl);
  if (!isUsableProduct(product)) {
    await api('/collector/tasks/' + item.id + '/result', {
      method: 'POST',
      body: JSON.stringify({
        agentKey: cfg.agentKey,
        success: false,
        error: (product && product.blocked ? '页面被验证码拦截，请先在 Chrome 完成验证后再轮询' : '页面未解析到真实商品'),
      }),
    });
    return 'fail';
  }

  await api('/collector/tasks/' + item.id + '/result', {
    method: 'POST',
    body: JSON.stringify({ agentKey: cfg.agentKey, success: true, product: toIngestProduct(product, Boolean(item.crawlAllSkus)) }),
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
  const cfg = await settings();
  const product = cfg.crawlAllSkus ? await enrichProductVariants(extracted) : extracted;
  const data = await api('/collector/ingest', {
    method: 'POST',
    body: JSON.stringify({
      ...toIngestProduct(product, Boolean(cfg.crawlAllSkus)),
      crawlAllSkus: Boolean(cfg.crawlAllSkus),
    }),
  });
  await chrome.storage.local.set({
    lastIngest: { at: Date.now(), ok: true, skuId: product.skuId, data },
  });
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        chrome.storage.local.set({
          lastIngest: { at: Date.now(), ok: false, error: error.message },
        });
        sendResponse({ ok: false, error: error.message });
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
