import { collectorIdentity, isAllowedCollectorApi, isLoopbackApiOrigin, normalizeCollectorApi, parseJwtPayload, API_DEFAULT_VERSION, DEFAULT_COLLECTOR_API, resolveStoredCollectorApi } from './jwt.js';

const defaults = {
  api: DEFAULT_COLLECTOR_API,
  token: '',
  tenant: '',
  apiHostVersion: 0,
};

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
    document.getElementById('log').textContent = '请填写有效的 API 地址。默认已指向线上；本机调试可填 localhost';
    throw new Error('非法 API 地址');
  }
  document.getElementById('api').value = api;
  await ensureApiPermission(api);
  await chrome.storage.local.set({
    api,
    apiHostVersion: API_DEFAULT_VERSION,
    token: document.getElementById('token').value.trim(),
    tenant: identity.fromJwt ? '' : document.getElementById('tenant').value.trim(),
    crawlAllSkus: false,
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

async function load() {
  const cfg = await chrome.storage.local.get({ ...defaults, lastIngest: null });
  const api = resolveStoredCollectorApi(cfg.api, cfg.apiHostVersion);
  if (api !== cfg.api || cfg.apiHostVersion !== API_DEFAULT_VERSION) {
    await chrome.storage.local.set({ api, apiHostVersion: API_DEFAULT_VERSION });
  }
  document.getElementById('api').value = api;
  document.getElementById('token').value = cfg.token;
  document.getElementById('tenant').value = cfg.tenant;
  refreshIdentity();
  if (cfg.lastIngest && cfg.lastIngest.at) {
    const ago = Math.round((Date.now() - cfg.lastIngest.at) / 1000);
    if (ago < 600) {
      document.getElementById('log').textContent = cfg.lastIngest.ok
        ? `上次采集成功（${ago}s 前） sku=${cfg.lastIngest.skuId}\n` + JSON.stringify(cfg.lastIngest.data, null, 2)
        : `上次采集失败（${ago}s 前）: ${cfg.lastIngest.error}`;
    }
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
        document.getElementById('log').textContent = '回传失败: ' + ((res && res.error) || 'unknown');
        return;
      }
      document.getElementById('log').textContent =
        '已写入选品复审（当前页主 SKU）\n' + JSON.stringify(res.data, null, 2);
    });
  } catch (error) {
    document.getElementById('log').textContent = error instanceof Error ? error.message : String(error);
  }
};

load();
