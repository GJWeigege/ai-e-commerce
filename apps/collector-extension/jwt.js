export function decodeJwtSegment(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((segment.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function parseJwtPayload(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    return JSON.parse(decodeJwtSegment(parts[1]));
  } catch {
    return null;
  }
}

/** 租户管理员/操作员用 JWT.tenantId；超管 token 无租户时用手动填写的工作租户 */
export function collectorIdentity(token, fallbackTenant) {
  const payload = parseJwtPayload(token);
  if (!payload) {
    return { tenantId: String(fallbackTenant || '').trim(), agentKey: 'chrome-ext-1', username: '', fromJwt: false };
  }
  const tenantId = payload.tenantId || String(fallbackTenant || '').trim();
  const agentKey = payload.sub ? 'chrome-ext-' + payload.sub : 'chrome-ext-1';
  return {
    tenantId,
    agentKey,
    username: payload.username || '',
    fromJwt: Boolean(payload.tenantId),
  };
}

/** 默认本机 API，避免未配置时把 JWT 发到公网明文 HTTP。线上地址在插件里手动填写。 */
export const LOCAL_COLLECTOR_API = 'http://localhost:3000/api/v1';
export const DEFAULT_COLLECTOR_API = LOCAL_COLLECTOR_API;
/** 从旧默认公网 HTTP 收回本机时 bump；已保存的自定义地址不会被覆盖 */
export const API_DEFAULT_VERSION = 2;

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isLegacyPackagedApi(api) {
  try {
    const url = new URL(normalizeCollectorApi(api, DEFAULT_COLLECTOR_API));
    const path = url.pathname.replace(/\/+$/, '');
    return isLoopbackHostname(url.hostname) && (url.port === '3000' || url.port === '') && path === '/api/v1';
  } catch {
    return false;
  }
}

/** 允许 http/https；缺协议时按 http 补齐。填 localhost 时补齐本机 API 端口与路径。 */
export function normalizeCollectorApi(api, fallback = DEFAULT_COLLECTOR_API) {
  let text = String(api || '').trim();
  if (!text) {
    return fallback;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    text = `http://${text}`;
  }
  try {
    const url = new URL(text);
    if (isLoopbackHostname(url.hostname)) {
      if (!url.port) url.port = '3000';
      const path = url.pathname.replace(/\/+$/, '');
      if (!path || path === '/') url.pathname = '/api/v1';
      return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
    }
  } catch {
    return text.replace(/\/+$/, '');
  }
  return text.replace(/\/+$/, '');
}

/** 未保存过自定义地址、或仍是旧包默认 localhost 时，用线上地址；已改成 localhost 的保持本机。 */
export function resolveStoredCollectorApi(storedApi, storedVersion) {
  if (storedVersion === API_DEFAULT_VERSION) {
    const text = String(storedApi || '').trim();
    return text ? normalizeCollectorApi(text, DEFAULT_COLLECTOR_API) : DEFAULT_COLLECTOR_API;
  }
  const text = String(storedApi || '').trim();
  if (!text || isLegacyPackagedApi(text)) {
    return DEFAULT_COLLECTOR_API;
  }
  return normalizeCollectorApi(text, DEFAULT_COLLECTOR_API);
}

export function isAllowedCollectorApi(api) {
  try {
    const url = new URL(normalizeCollectorApi(api));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLoopbackApiOrigin(originPattern) {
  try {
    const origin = String(originPattern || '').replace(/\/\*$/, '').replace(/\/+$/, '');
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
  } catch {
    return false;
  }
}
