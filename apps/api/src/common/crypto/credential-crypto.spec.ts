import { decryptSecret, encryptSecret } from './credential-crypto';

describe('credential-crypto', () => {
  const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const originalJwt = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-shop-key';
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
    process.env.JWT_SECRET = originalJwt;
  });

  it('round-trips a shop token', () => {
    const token = 'wb-content-token-示例';
    const packed = encryptSecret(token);
    expect(packed).not.toContain(token);
    expect(decryptSecret(packed)).toBe(token);
  });

  it('rejects empty tokens', () => {
    expect(() => encryptSecret('  ')).toThrow('店铺 Token 不能为空');
  });

  it('rejects corrupted ciphertext', () => {
    expect(() => decryptSecret('aa:bb')).toThrow('店铺凭证密文已损坏');
  });
});
