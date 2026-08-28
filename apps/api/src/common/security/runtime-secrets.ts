const WEAK_SECRETS = new Set([
  '',
  'change-me-in-production',
  'change-me-jwt-secret',
  'change-me-shop-secret',
  'secret',
  'jwt-secret',
  'password',
]);

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function isWeakSecret(value: string | undefined, minLength = 24): boolean {
  const text = String(value || '').trim();
  if (text.length < minLength) {
    return true;
  }
  if (WEAK_SECRETS.has(text.toLowerCase())) {
    return true;
  }
  return /change-me|please-rotate|changeme/i.test(text);
}

/** 生产环境拒绝默认/过短密钥，避免带着示例配置对外服务 */
export function assertRuntimeSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (!isProductionRuntime(env)) {
    return;
  }
  if (isWeakSecret(env.JWT_SECRET)) {
    throw new Error('生产环境必须配置足够强的 JWT_SECRET（至少 24 位，且不能使用示例值）');
  }
  if (isWeakSecret(env.CREDENTIAL_ENCRYPTION_KEY)) {
    throw new Error('生产环境必须单独配置足够强的 CREDENTIAL_ENCRYPTION_KEY，不能回退 JWT_SECRET');
  }
  if (env.CREDENTIAL_ENCRYPTION_KEY === env.JWT_SECRET) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY 不能与 JWT_SECRET 相同');
  }
}

/** 把 12h / 7d / 3600 解析成秒，供 jsonwebtoken expiresIn 使用 */
export function parseJwtExpiresIn(raw: string | undefined, fallbackSeconds = 7 * 24 * 60 * 60): number {
  const text = String(raw || '').trim();
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  const match = text.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return fallbackSeconds;
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return amount * multiplier;
}
