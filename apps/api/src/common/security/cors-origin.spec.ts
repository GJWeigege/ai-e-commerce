import { isAllowedCorsOrigin } from './cors-origin';

describe('cors origin allowlist', () => {
  it('allows the configured web origin', () => {
    expect(isAllowedCorsOrigin('http://localhost:8000', { WEB_ORIGIN: 'http://localhost:8000' })).toBe(true);
  });

  it('rejects unknown websites', () => {
    expect(
      isAllowedCorsOrigin('https://evil.example', {
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://shop.example',
      }),
    ).toBe(false);
  });

  it('allows unpacked chrome extensions in production when no ID allowlist is set', () => {
    expect(
      isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', { NODE_ENV: 'production' }),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', { NODE_ENV: 'development' }),
    ).toBe(true);
  });

  it('restricts chrome extensions to CHROME_EXTENSION_IDS when that allowlist is set', () => {
    const env = {
      NODE_ENV: 'production',
      CHROME_EXTENSION_IDS: 'abcdefghijklmnopabcdefghijklmnop',
    };
    expect(isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', env)).toBe(true);
    expect(isAllowedCorsOrigin('chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', env)).toBe(false);
  });
});
