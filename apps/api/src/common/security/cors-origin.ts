function trimOrigin(value: string): string {
  return value.trim().replace(/\/$/, '');
}

export function allowedWebOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const primary = trimOrigin(env.WEB_ORIGIN || 'http://localhost:8000');
  const extras = String(env.WEB_ORIGINS || '')
    .split(',')
    .map(trimOrigin)
    .filter(Boolean);
  return [...new Set([primary, ...extras])];
}

/**
 * 浏览器 Origin 白名单。
 * 无 Origin 的请求（curl / 健康检查 / 已声明 host_permissions 的扩展 fetch）放行；
 * 生产环境不允许任意 chrome-extension://，需通过 CHROME_EXTENSION_IDS 点名。
 */
export function isAllowedCorsOrigin(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) {
    return true;
  }
  if (allowedWebOrigins(env).includes(trimOrigin(origin))) {
    return true;
  }
  if (origin.startsWith('chrome-extension://')) {
    const extensionId = origin.slice('chrome-extension://'.length).split('/')[0];
    const allowIds = String(env.CHROME_EXTENSION_IDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (allowIds.length > 0) {
      return allowIds.includes(extensionId);
    }
    return env.NODE_ENV !== 'production';
  }
  return false;
}
