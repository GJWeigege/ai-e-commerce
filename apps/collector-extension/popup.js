import { collectorIdentity, parseJwtPayload } from './jwt.js';

const defaults = {
  api: 'http://localhost:3000/api/v1',
  token: '',
  tenant: '',
  crawlAllSkus: false,
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
  await chrome.storage.local.set({
    api: document.getElementById('api').value.trim() || defaults.api,
    token: document.getElementById('token').value.trim(),
    tenant: identity.fromJwt ? '' : document.getElementById('tenant').value.trim(),
    crawlAllSkus: document.getElementById('crawlAllSkus').checked,
  });
  return identity;
}

async function load() {
  const cfg = await chrome.storage.local.get({ ...defaults, lastIngest: null });
  document.getElementById('api').value = cfg.api;
  document.getElementById('token').value = cfg.token;
  document.getElementById('tenant').value = cfg.tenant;
  document.getElementById('crawlAllSkus').checked = Boolean(cfg.crawlAllSkus);
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
  await persist();
  document.getElementById('log').textContent = '已保存';
};

document.getElementById('start').onclick = async () => {
  await persist();
  chrome.runtime.sendMessage({ type: 'START' }, (res) => {
    document.getElementById('log').textContent = res && res.ok ? '轮询已启动' : '启动失败: ' + ((res && res.error) || '');
  });
};

document.getElementById('stop').onclick = () => {
  chrome.runtime.sendMessage({ type: 'STOP' });
  document.getElementById('log').textContent = '已停止';
};

document.getElementById('manual').onclick = async () => {
  await persist();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  document.getElementById('log').textContent = '正在采集当前页主 SKU（勾选「全部规格」后才会跟进每个规格页）...';
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
};

load();
