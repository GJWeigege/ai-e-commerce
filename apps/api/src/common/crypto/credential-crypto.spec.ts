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

  it('tells the operator to re-save the token when the encryption key does not match', () => {
    const packed = encryptSecret('wb-content-token');
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'a-different-shop-key';
    expect(() => decryptSecret(packed)).toThrow(/重新保存 Token/);
  });
});
