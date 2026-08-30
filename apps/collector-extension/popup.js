import { collectorIdentity, isAllowedCollectorApi, isLoopbackApiOrigin, normalizeCollectorApi, parseJwtPayload, API_DEFAULT_VERSION, DEFAULT_COLLECTOR_API, resolveStoredCollectorApi } from './jwt.js';

const defaults = {
  api: DEFAULT_COLLECTOR_API,
  token: '',
  tenant: '',
  sellerBridge: false,
  apiHostVersion: 0,
};

function paintManifestVersion() {
  const version = chrome.runtime.getManifest().version;
  document.getElementById('extVersion').textContent = `v${version}`;
  document.getElementById('extVersionText').textContent = version;
}

function refreshIdentity() {
  const token = document.getElementById('token').value;
  const fallback = document.getElementById('tenant').value;
  const identity = collectorIdentity(token, fallback);
  const wrap = document.getElementById('tenantWrap');
  if (!token.trim() || !parseJwtPayload(token) || identity.fromJwt) {
    wrap.hidden = true;
    return identity;
  }
  wrap.hidden = false;
  return identity;
}

async function persist() {
  const identity = refreshIdentity();
  const api = normalizeCollectorApi(document.getElementById('api').value, defaults.api);
  if (!isAllowedCollectorApi(api)) {
    document.getElementById('log').textContent = '请填写有效的 API 地址。默认本机 localhost:3000；线上请填 https://';
    throw new Error('非法 API 地址');
  }
  try {
    const parsed = new URL(api);
    if (parsed.protocol === 'http:' && !isLoopbackApiOrigin(`${parsed.origin}/*`)) {
      document.getElementById('log').textContent = '警告：非本机 HTTP 会明文发送登录 Token，建议改用 https://';
    }
  } catch {
    /* normalizeCollectorApi 已校验 */
  }
  document.getElementById('api').value = api;
  await ensureApiPermission(api);
  await chrome.storage.local.set({
    api,
    apiHostVersion: API_DEFAULT_VERSION,
    token: document.getElementById('token').value.trim(),
    tenant: identity.fromJwt ? '' : document.getElementById('tenant').value.trim(),
    crawlAllSkus: false,
    sellerBridge: document.getElementById('sellerBridge').checked,
  });
  return identity;
}

async function ensureApiPermission(api) {
  const origin = `${new URL(api).origin}/*`;
  if (isLoopbackApiOrigin(origin)) {
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (granted) {
    return;
  }
  const ok = await chrome.permissions.request({ origins: [origin] });
  if (!ok) {
    throw new Error('未授权访问该 API 地址');
  }
}

const PRODUCT_DIM_RE = /^(длина, мм|ширина, мм|высота, мм|вес товара|вес, кг|вес$|вес,|масса|диаметр дна|высота стенки)/;
const PACKAGE_DIM_RE = /длина упаковк|ширина упаковк|высота упаковк|вес брутто|вес в упаков/;

function dimName(item) {
  return String((item && item.name) || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function harvestSummary(harvest) {
  if (!harvest) return '';
  const specs = Array.isArray(harvest.dimSpecs) ? harvest.dimSpecs : [];
  const product = specs.filter((item) => PRODUCT_DIM_RE.test(dimName(item)) && !PACKAGE_DIM_RE.test(dimName(item)));
  const packaging = specs.filter((item) => PACKAGE_DIM_RE.test(dimName(item)));
  const attrs = harvest.attrs && typeof harvest.attrs === 'object' ? harvest.attrs : {};
  const attrNames = Object.keys(attrs);
  const others = specs.filter(
    (item) =>
      !PRODUCT_DIM_RE.test(dimName(item)) && !PACKAGE_DIM_RE.test(dimName(item)) && attrNames.indexOf(item.name) < 0,
  );
  const dims = product.map((item) => item.name + '=' + item.value).join(', ');
  const pkgDims = packaging.map((item) => item.name + '=' + item.value).join(', ');
  const attrLine = attrNames.map((name) => name + '=' + String(attrs[name]).slice(0, 40)).join(', ');
  const extraSpecs = others
    .slice(0, 24)
    .map((item) => item.name + '=' + String(item.value).slice(0, 40))
    .join(', ');
  const fetches = Array.isArray(harvest.fetches)
    ? harvest.fetches
        .map((item) => {
          const status = item.ok ? String(item.status) : String(item.status || 'err') + (item.error ? '/' + item.error : '');
          const bytes = item.bytes ? ' ' + item.bytes + 'b' : '';
          const widgets = item.widgets ? ' {' + String(item.widgets).slice(0, 80) + '}' : '';
          return status + bytes + widgets;
        })
        .join('\n')
    : '';
  const chars = Array.isArray(harvest.charNames) && harvest.charNames.length ? harvest.charNames.join(', ') : '';
  const meta = harvest.meta && typeof harvest.meta === 'object' ? harvest.meta : {};
  const metaLine = [
    meta.brand ? '品牌=' + meta.brand : '',
    meta.sellerName ? '卖家=' + meta.sellerName : '',
    meta.categoryPath ? '类目=' + String(meta.categoryPath).slice(0, 80) : '',
    meta.description ? '描述=' + String(meta.description).length + '字' : '',
    meta.rating ? '评分=' + meta.rating : '',
    harvest.imgCount ? '图=' + harvest.imgCount : '',
    meta.deliveryWarehouse ? '发货仓=' + String(meta.deliveryWarehouse).slice(0, 40) : '',
    meta.deliveryText ? '时效=' + String(meta.deliveryText).slice(0, 40) : '',
  ]
    .filter(Boolean)
    .join(' | ');
  return (
    '\n商品尺寸/重量: ' +
    (dims || '未抽出') +
    '\n发货包裹尺寸/毛重: ' +
    (pkgDims || '未抽出') +
    '\n上架属性: ' +
    (attrLine || '未归一化到任何字典字段') +
    '\n其他规格: ' +
    (extraSpecs || chars || '无') +
    (metaLine ? '\n商品信息: ' + metaLine : '') +
    (Array.isArray(harvest.queuedWidgets) && harvest.queuedWidgets.length
      ? '\n排队组件: ' + harvest.queuedWidgets.join(', ')
      : '') +
    '\nOzon API: pages=' +
    (harvest.pageCount || 0) +
    (fetches ? '\n' + fetches : '') +
    (harvest.error ? '\nharvest error: ' + harvest.error : '') +
    (Array.isArray(harvest.debug) && harvest.debug.length
      ? '\n字段探测: ' + harvest.debug.map((item) => item.key + ' → ' + item.snippet).join('\n')
      : '')
  );
}

const SELLER_ERROR_HINTS = {
  no_login: '未登录 seller.ozon.ru，请先登录卖家后台',
  no_data: '该 SKU 在选品分析里没有数据',
};

function sellerBridgeSummary(state) {
  if (!state || !state.at || Date.now() - state.at > 600000) return '';
  const reason = state.error ? SELLER_ERROR_HINTS[state.error] || state.error : '';
  const perSku = Object.values(state.errors || {})
    .map((code) => SELLER_ERROR_HINTS[code] || code)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .join(', ');
  return (
    '\n卖家后台补数: 命中 ' +
    (state.hits || 0) +
    '/' +
    (state.asked || 0) +
    (reason ? '（' + reason + '）' : '') +
    (perSku ? '（' + perSku + '）' : '') +
    (state.volume != null ? '\n卖家体积: ' + state.volume : '') +
    (state.hasWeight ? '\n卖家重量: 有' : '') +
    (state.hasDimension ? '\n卖家尺寸: 有' : '') +
    (Array.isArray(state.rawKeys) && state.rawKeys.length ? '\n卖家字段: ' + state.rawKeys.join(', ') : '')
  );
}

async function load() {
  const cfg = await chrome.storage.local.get({
    ...defaults,
    lastIngest: null,
    lastHarvest: null,
    lastSellerBridge: null,
  });
  document.getElementById('sellerBridge').checked = Boolean(cfg.sellerBridge);
  const api = resolveStoredCollectorApi(cfg.api, cfg.apiHostVersion);
  if (api !== cfg.api || cfg.apiHostVersion !== API_DEFAULT_VERSION) {
    await chrome.storage.local.set({ api, apiHostVersion: API_DEFAULT_VERSION });
  }
  document.getElementById('api').value = api;
  document.getElementById('token').value = cfg.token;
  document.getElementById('tenant').value = cfg.tenant;
  refreshIdentity();
  const harvest = (cfg.lastIngest && cfg.lastIngest.harvest) || cfg.lastHarvest;
  const sellerLine = sellerBridgeSummary(cfg.lastSellerBridge);
  if (cfg.lastIngest && cfg.lastIngest.at) {
    const ago = Math.round((Date.now() - cfg.lastIngest.at) / 1000);
    if (ago < 600) {
      document.getElementById('log').textContent = cfg.lastIngest.ok
        ? `上次采集成功（${ago}s 前） sku=${cfg.lastIngest.skuId}` +
          harvestSummary(harvest) +
          sellerLine +
          '\n' +
          JSON.stringify(cfg.lastIngest.data, null, 2)
        : `上次采集失败（${ago}s 前）: ${cfg.lastIngest.error}` + harvestSummary(harvest) + sellerLine;
    }
  } else if (harvest && harvest.at && Date.now() - harvest.at < 600000) {
    document.getElementById('log').textContent = '上次包装探测' + harvestSummary(harvest) + sellerLine;
  }
}

document.getElementById('token').addEventListener('input', refreshIdentity);
document.getElementById('tenant').addEventListener('input', refreshIdentity);

document.getElementById('save').onclick = async () => {
  try {
    await persist();
    document.getElementById('log').textContent = '已保存';
  } catch (error) {
    document.getElementById('log').textContent = error instanceof Error ? error.message : String(error);
  }
};

document.getElementById('start').onclick = async () => {
  try {
    await persist();
    chrome.runtime.sendMessage({ type: 'START' }, (res) => {
      document.getElementById('log').textContent = res && res.ok ? '轮询已启动' : '启动失败: ' + ((res && res.error) || '');
    });
  } catch (error) {
    document.getElementById('log').textContent = error instanceof Error ? error.message : String(error);
  }
};

document.getElementById('stop').onclick = () => {
  chrome.runtime.sendMessage({ type: 'STOP' });
  document.getElementById('log').textContent = '已停止';
};

document.getElementById('manual').onclick = async () => {
  try {
    await persist();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    document.getElementById('log').textContent = '正在采集当前页主 SKU...';
    chrome.runtime.sendMessage({ type: 'INGEST_TAB', tabId: tab.id }, (res) => {
      if (chrome.runtime.lastError) {
        document.getElementById('log').textContent = '插件通信失败: ' + chrome.runtime.lastError.message;
        return;
      }
      if (!res || !res.ok) {
        document.getElementById('log').textContent =
          '回传失败: ' + ((res && res.error) || 'unknown') + harvestSummary(res && res.harvest);
        return;
      }
      document.getElementById('log').textContent =
        '已写入商品库（当前页主 SKU）' + harvestSummary(res.harvest) + '\n' + JSON.stringify(res.data, null, 2);
    });
  } catch (error) {
    document.getElementById('log').textContent = error instanceof Error ? error.message : String(error);
  }
};

paintManifestVersion();
load();
