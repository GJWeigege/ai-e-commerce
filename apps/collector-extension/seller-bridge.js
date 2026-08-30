// seller.ozon.ru 页面内桥：复用卖家后台登录态查「选品分析（Что продавать на Ozon）」v3。
// 该接口按 sku 查任意卖家的商品，用来补齐 Ozon 商品页拿不到的 FBO/FBS 库存与销量。
// 必须跑在 seller.ozon.ru 页面里：同源 fetch 才会带上 sc_* Cookie，Origin 头也才合法。
const SELLER_V3_API = 'https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/data/v3';
const MAX_CONCURRENT = 2;
const BATCH_PAUSE_MS = 1000;
const REQ_TIMEOUT_MS = 30_000;
const MAX_SKUS = 60;

function sellerCompanyId() {
  const match = String(document.cookie || '').match(/(?:^|;\s*)sc_company_id=([^;]*)/);
  return match ? match[1] : '';
}

function sellerText(raw) {
  if (raw == null) return '';
  const text = String(raw).replace(/\s+/g, ' ').trim();
  return text && text !== '[object Object]' ? text.slice(0, 120) : '';
}

function sellerCount(raw) {
  const num = Number(raw);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : undefined;
}

function sellerAmount(raw) {
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

async function fetchSellerV3(sku, companyId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(SELLER_V3_API, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-o3-app-name': 'seller-ui',
        'x-o3-company-id': companyId,
        'x-o3-page-type': 'analytics_platform',
      },
      body: JSON.stringify({
        limit: '1',
        offset: '0',
        filter: { stock: 'any_stock', period: 'monthly', sku: String(sku) },
        sort: { key: 'sum_missed_gmv_desc' },
      }),
    });
    if (!res.ok) return { error: 'http_' + res.status };
    const json = await res.json();
    const item = json && Array.isArray(json.items) ? json.items[0] : null;
    return item ? { item } : { error: 'no_data' };
  } catch (error) {
    return { error: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

function sellerDeepLogistics(item) {
  const found = {};
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) {
      node.slice(0, 20).forEach((child) => visit(child, depth + 1));
      return;
    }
    Object.keys(node).forEach((key) => {
      const lower = key.toLowerCase();
      if (found.weight == null && /^(weight|weightgrams|itemweight|grossweight|packageweight|mass)$/.test(lower)) {
        found.weight = sellerAmount(node[key]);
      }
      if (
        !found.dimension &&
        /^(dimension|dimensions|packagesize|packagedimension|size)$/.test(lower) &&
        typeof node[key] === 'string'
      ) {
        found.dimension = sellerText(node[key]);
      }
      if (found.depth == null && /^(depth|length)$/.test(lower)) found.depth = sellerAmount(node[key]);
      if (found.width == null && /^width$/.test(lower)) found.width = sellerAmount(node[key]);
      if (found.height == null && /^height$/.test(lower)) found.height = sellerAmount(node[key]);
    });
    Object.keys(node).forEach((key) => visit(node[key], depth + 1));
  };
  visit(item, 0);
  return found;
}

function normalizeSellerItem(item) {
  const nested = sellerDeepLogistics(item);
  const out = {
    brand: sellerText(item.brand),
    article: sellerText(item.article),
    sellerName: sellerText(item.sellerName),
    sellerId: sellerText(item.sellerId),
    category: sellerText(item.category3),
    // volume 的单位（升 / cm³）尚未在卖家后台实测确认，只做展示，不参与包裹尺寸推算
    volume: sellerAmount(item.volume),
    weight: sellerAmount(
      item.weight != null
        ? item.weight
        : item.weightGrams != null
          ? item.weightGrams
          : item.itemWeight != null
            ? item.itemWeight
            : item.grossWeight != null
              ? item.grossWeight
              : item.packageWeight != null
                ? item.packageWeight
                : item.mass != null
                  ? item.mass
                  : nested.weight,
    ),
    dimension: sellerText(
      item.dimension ||
        item.dimensions ||
        item.packageSize ||
        item.size ||
        item.packageDimension ||
        nested.dimension,
    ),
    depth: sellerAmount(item.depth != null ? item.depth : item.length != null ? item.length : nested.depth),
    width: sellerAmount(item.width != null ? item.width : nested.width),
    height: sellerAmount(item.height != null ? item.height : nested.height),
    rawKeys: Object.keys(item || {}).slice(0, 80),
    avgDeliveryDays: sellerAmount(item.avgDeliveryDays != null ? item.avgDeliveryDays : item.deliveryDays),
    fulfillment: sellerText(item.fulfillment || item.deliverySchema || item.deliveryType),
    stock: sellerCount(item.stock),
    fboStock: sellerCount(item.fboStock),
    fbsStock: sellerCount(item.fbsStock),
    salesCount: sellerCount(item.soldCount),
    avgPrice: sellerAmount(item.avgPrice),
    minSellerPrice: sellerAmount(item.minSellerPrice),
  };
  Object.keys(out).forEach((key) => {
    if (out[key] === '' || out[key] === undefined) delete out[key];
  });
  return out;
}

async function collectSellerInsights(skus) {
  const companyId = sellerCompanyId();
  if (!companyId) return { error: 'no_login' };
  const wanted = [];
  const seen = {};
  for (const raw of Array.isArray(skus) ? skus : []) {
    const sku = String(raw || '');
    if (!/^\d{6,}$/.test(sku) || seen[sku]) continue;
    seen[sku] = true;
    wanted.push(sku);
    if (wanted.length >= MAX_SKUS) break;
  }
  if (!wanted.length) return { items: {} };

  const items = {};
  const errors = {};
  // 对齐 ozon-scout 实测节流：2 并发 + 每批间隔 1s，避免卖家接口限流
  for (let offset = 0; offset < wanted.length; offset += MAX_CONCURRENT) {
    const chunk = wanted.slice(offset, offset + MAX_CONCURRENT);
    const results = await Promise.all(chunk.map((sku) => fetchSellerV3(sku, companyId)));
    results.forEach((result, index) => {
      const sku = chunk[index];
      if (result && result.item) items[sku] = normalizeSellerItem(result.item);
      else if (result && result.error) errors[sku] = result.error;
    });
    if (offset + MAX_CONCURRENT < wanted.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }
  return { items, errors };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'SELLER_QUERY') return false;
  collectSellerInsights(message.skus)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String((error && error.message) || error) }));
  return true;
});
