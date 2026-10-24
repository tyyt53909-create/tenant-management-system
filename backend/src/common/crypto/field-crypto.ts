import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class FieldCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldCryptoError';
  }
}

export function resolveFieldKey(raw: string | undefined): Buffer {
  if (!raw?.trim()) {
    throw new FieldCryptoError('未配置 FIELD_ENCRYPTION_KEY');
  }
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }
  const asBase64 = Buffer.from(value, 'base64');
  if (asBase64.length === 32 && value !== asBase64.toString('utf8')) {
    return asBase64;
  }
  const asUtf8 = Buffer.from(value, 'utf8');
  if (asUtf8.length === 32) {
    return asUtf8;
  }
  throw new FieldCryptoError('FIELD_ENCRYPTION_KEY 必须是 32 字节，可用 base64、64 位十六进制或 32 字节原文');
}

/** 旧密钥列表：逗号分隔，用于换钥过渡期解密历史密文（新钥始终加密）。 */
export function resolvePreviousFieldKeys(raw: string | undefined): Buffer[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => resolveFieldKey(part));
}

export function isEncryptedField(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}

export function normalizeIdNumber(plain: string): string {
  return plain.trim().replace(/\s+/g, '').toUpperCase();
}

export function encryptField(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptField(payload: string, key: Buffer): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new FieldCryptoError('证件号密文格式无法识别');
  }
  const [, ivPart, tagPart, dataPart] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  try {
    const plain = Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    throw new FieldCryptoError('证件号解密失败');
  }
}

/** 依次尝试多把密钥解密；全部失败时抛出最后一次错误。 */
export function decryptFieldWithKeys(payload: string, keys: Buffer[]): string {
  if (keys.length === 0) {
    throw new FieldCryptoError('没有可用的解密密钥');
  }
  let lastError: unknown;
  for (const key of keys) {
    try {
      return decryptField(payload, key);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new FieldCryptoError('证件号解密失败');
}

export function hashIdNumber(plain: string, key: Buffer): string {
  return createHmac('sha256', key).update(`id-number:${normalizeIdNumber(plain)}`).digest('hex');
}

/** 保留前 4 位和后 4 位。长度不足 9 时全部遮住，避免短号码被还原。 */
export function maskIdNumber(plain: string): string {
  const value = normalizeIdNumber(plain);
  if (value.length <= 8) {
    return '*'.repeat(Math.max(value.length, 4));
  }
  const hidden = '*'.repeat(value.length - 8);
  return `${value.slice(0, 4)}${hidden}${value.slice(-4)}`;
}

export function maskStoredIdNumber(stored: string, key: Buffer | null): string {
  return maskStoredIdNumberWithKeys(stored, key ? [key] : []);
}

export function maskStoredIdNumberWithKeys(stored: string, keys: Buffer[]): string {
  try {
    const plain = isEncryptedField(stored) ? decryptFieldWithKeys(stored, keys) : stored;
    return maskIdNumber(plain);
  } catch {
    return '********';
  }
}

function requireKey(key: Buffer | null): Buffer {
  if (!key) {
    throw new FieldCryptoError('未配置 FIELD_ENCRYPTION_KEY');
  }
  return key;
}
