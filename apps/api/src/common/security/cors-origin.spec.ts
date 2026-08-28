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

  it('allows chrome extensions only in non-production unless IDs are listed', () => {
    expect(
      isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', { NODE_ENV: 'development' }),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', { NODE_ENV: 'production' }),
    ).toBe(false);
    expect(
      isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', {
        NODE_ENV: 'production',
        CHROME_EXTENSION_IDS: 'abcdefghijklmnopabcdefghijklmnop',
      }),
    ).toBe(true);
  });
});
