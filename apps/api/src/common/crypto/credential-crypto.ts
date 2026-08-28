import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { loadRootEnv } from '../security/load-root-env';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

function encryptionKey(): Buffer {
  let raw = String(process.env.CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    loadRootEnv();
    raw = String(process.env.CREDENTIAL_ENCRYPTION_KEY || '').trim();
  }
  if (!raw) {
    throw new Error('未配置 CREDENTIAL_ENCRYPTION_KEY，无法加解密店铺 Token');
  }
  return createHash('sha256').update(raw).digest();
}

/** 把店铺 API Token 加密后入库。格式 ivHex:tagHex:cipherHex */
export function encryptSecret(plain: string): string {
  const text = String(plain || '').trim();
  if (!text) {
    throw new Error('店铺 Token 不能为空');
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const parts = String(payload || '').split(':');
  if (parts.length !== 3 || parts.some((item) => !item)) {
    throw new Error('店铺凭证密文已损坏，请重新保存 Token');
  }
  const [ivHex, tagHex, dataHex] = parts;
  try {
    const decipher = createDecipheriv(ALGO, encryptionKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unsupported state|unable to authenticate data|Invalid authentication tag|bad decrypt/i.test(message)) {
      throw new Error('店铺凭证无法解密（加密密钥已变更或密文已损坏），请重新保存 Token');
    }
    throw error;
  }
}
