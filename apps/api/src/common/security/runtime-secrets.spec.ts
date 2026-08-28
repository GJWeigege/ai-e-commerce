import { assertRuntimeSecrets, isWeakSecret, parseJwtExpiresIn } from './runtime-secrets';

describe('runtime secrets', () => {
  it('treats short and placeholder secrets as weak', () => {
    expect(isWeakSecret('change-me-in-production')).toBe(true);
    expect(isWeakSecret('short')).toBe(true);
    expect(isWeakSecret('a-sufficiently-long-production-secret')).toBe(false);
    expect(isWeakSecret('change-me-in-production-please-rotate')).toBe(true);
  });

  it('refuses placeholder secrets in production', () => {
    expect(() =>
      assertRuntimeSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'change-me-jwt-secret',
        CREDENTIAL_ENCRYPTION_KEY: 'another-sufficiently-long-key',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('allows weak secrets outside production', () => {
    expect(() =>
      assertRuntimeSecrets({
        NODE_ENV: 'development',
        JWT_SECRET: 'change-me-in-production',
      }),
    ).not.toThrow();
  });

  it('parses jwt expiresIn', () => {
    expect(parseJwtExpiresIn('12h')).toBe(12 * 60 * 60);
    expect(parseJwtExpiresIn('7d')).toBe(7 * 24 * 60 * 60);
    expect(parseJwtExpiresIn('3600')).toBe(3600);
    expect(parseJwtExpiresIn('nope')).toBe(7 * 24 * 60 * 60);
  });
});
