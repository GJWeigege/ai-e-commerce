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
