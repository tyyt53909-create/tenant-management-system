import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import { CryptoService } from './crypto.service.js';

/**
 * 覆盖 CryptoService 的「密钥来源」接线本身。
 *
 * 背景：T177 只测了 field-crypto 的纯函数（密钥由参数传入），tenants.service.spec 又把
 * CryptoService 整个 mock 掉，于是「代码读 FIELD_ENCRYPTION_KEY、配置只给 ENCRYPTION_KEY」
 * 这类失配不会被任何测试发现。本文件用真实 ConfigService 接线来兜住它。
 */
const KEY = '0123456789abcdef0123456789abcdef';

describe('CryptoService 密钥来源', () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;
  const originalFieldKey = process.env.FIELD_ENCRYPTION_KEY;
  const originalPreviousKey = process.env.ENCRYPTION_KEY_PREVIOUS;

  afterEach(() => {
    restoreEnv('ENCRYPTION_KEY', originalEncryptionKey);
    restoreEnv('FIELD_ENCRYPTION_KEY', originalFieldKey);
    restoreEnv('ENCRYPTION_KEY_PREVIOUS', originalPreviousKey);
  });

  it('从 ENCRYPTION_KEY 取密钥（与 .env.example / compose / docs 口径一致）', () => {
    process.env.ENCRYPTION_KEY = KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;

    const service = new CryptoService(new ConfigService({ ENCRYPTION_KEY: KEY }));
    const stored = service.encrypt('440101199001011234');

    expect(stored.startsWith('v1:')).toBe(true);
    expect(service.decrypt(stored)).toBe('440101199001011234');
    expect(service.hashIdNumber('440101199001011234')).toHaveLength(64);
  });

  it('仍兼容旧名 FIELD_ENCRYPTION_KEY', () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.FIELD_ENCRYPTION_KEY = KEY;

    const service = new CryptoService(new ConfigService({}));
    const stored = service.encrypt('440101199001011234');

    expect(service.decrypt(stored)).toBe('440101199001011234');
  });

  it('两个名字都没配置时抛错，而不是静默退回明文', () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;

    const service = new CryptoService(new ConfigService({}));

    expect(() => service.encrypt('440101199001011234')).toThrow(/ENCRYPTION_KEY/);
    expect(() => service.decrypt('v1:aa:bb:cc')).toThrow(/ENCRYPTION_KEY/);
  });

  it('过渡期旧钥可解密历史密文，新数据只用当前钥', () => {
    const oldKey = 'abcdef0123456789abcdef0123456789';
    const oldService = new CryptoService(new ConfigService({ ENCRYPTION_KEY: oldKey }));
    const legacy = oldService.encrypt('440101199001011234');

    const service = new CryptoService(
      new ConfigService({ ENCRYPTION_KEY: KEY, ENCRYPTION_KEY_PREVIOUS: oldKey }),
    );

    expect(service.decrypt(legacy)).toBe('440101199001011234');
    expect(service.maskStored(legacy)).toBe('4401**********1234');

    const fresh = service.encrypt('440101199001011234');
    expect(() => oldService.decrypt(fresh)).toThrow();
  });

  it('解密失败时抛错，不会被列表脱敏吞掉', () => {
    process.env.ENCRYPTION_KEY = KEY;

    const service = new CryptoService(new ConfigService({ ENCRYPTION_KEY: KEY }));

    expect(() => service.decrypt('v1:not-a-real-payload')).toThrow();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
