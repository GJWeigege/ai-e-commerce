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
 * 无 Origin 的请求（curl / 健康检查）放行。
 * Chrome 插件 service worker 的 fetch 会带 chrome-extension://<id>；
 * 解压加载时 ID 会变，未配置 CHROME_EXTENSION_IDS 时放行全部扩展 Origin（接口仍要 JWT）。
 * 配了 CHROME_EXTENSION_IDS 则只放行名单内的 ID。
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
    return Boolean(extensionId);
  }
  return false;
}
