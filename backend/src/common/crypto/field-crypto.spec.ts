import { describe, expect, it } from 'vitest';
import { buildIdNumberMigration } from './id-number-migration.js';
import {
  decryptField,
  encryptField,
  hashIdNumber,
  isEncryptedField,
  maskIdNumber,
  maskStoredIdNumber,
  resolveFieldKey,
} from './field-crypto.js';

const key = resolveFieldKey('0123456789abcdef0123456789abcdef');
const idNumber = '440101199001011234';

describe('field crypto', () => {
  it('密文带版本号，且不包含明文', () => {
    const stored = encryptField(idNumber, key);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(idNumber);
    expect(decryptField(stored, key)).toBe(idNumber);
  });

  it('篡改密文或使用另一把钥匙时解密失败', () => {
    const stored = encryptField(idNumber, key);
    const other = resolveFieldKey('abcdef0123456789abcdef0123456789');
    expect(() => decryptField(stored, other)).toThrow(/解密失败/);
    const parts = stored.split(':');
    parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('a') ? 'b' : 'a'}`;
    expect(() => decryptField(parts.join(':'), key)).toThrow(/解密失败/);
  });

  it('证件号哈希忽略大小写和空格', () => {
    expect(hashIdNumber('ab12 3x', key)).toBe(hashIdNumber('AB123X', key));
  });

  it('脱敏保留前四位和后四位', () => {
    expect(maskIdNumber(idNumber)).toBe('4401**********1234');
    expect(maskIdNumber('1234567')).toBe('*******');
  });

  it('已加密的库存值先解密再脱敏', () => {
    const stored = encryptField(idNumber, key);
    expect(maskStoredIdNumber(stored, key)).toBe('4401**********1234');
    expect(maskStoredIdNumber(stored, key)).not.toContain(idNumber);
  });

  it('没有钥匙时不能把密文原样返回', () => {
    const stored = encryptField(idNumber, key);
    expect(maskStoredIdNumber(stored, null)).toBe('********');
  });
});

describe('id number migration plan', () => {
  it('明文会被加密，再次计划时不再改密文', () => {
    const first = buildIdNumberMigration([{ id: 'reg-1', idNumber }], key, 'encrypt');
    expect(first.duplicates).toEqual([]);
    expect(first.updates).toHaveLength(1);
    expect(isEncryptedField(first.updates[0].idNumber)).toBe(true);
    expect(first.updates[0].idNumber).not.toContain(idNumber);
    expect(first.updates[0].idNumberHash).toBe(hashIdNumber(idNumber, key));

    const second = buildIdNumberMigration(
      [{ id: 'reg-1', idNumber: first.updates[0].idNumber, idNumberHash: first.updates[0].idNumberHash }],
      key,
      'encrypt',
    );
    expect(second.updates).toEqual([]);
  });

  it('重复证件号只报告冲突，调用方不得写入', () => {
    const plan = buildIdNumberMigration(
      [
        { id: 'reg-1', idNumber },
        { id: 'reg-2', idNumber: '440101199001011234' },
      ],
      key,
      'encrypt',
    );
    expect(plan.duplicates).toEqual([{ hash: hashIdNumber(idNumber, key), ids: ['reg-1', 'reg-2'] }]);
  });

  it('回滚把密文解回明文并清空哈希，明文行跳过', () => {
    const stored = encryptField(idNumber, key);
    const plan = buildIdNumberMigration(
      [
        { id: 'reg-1', idNumber: stored, idNumberHash: 'abc' },
        { id: 'reg-2', idNumber, idNumberHash: null },
      ],
      key,
      'rollback',
    );
    expect(plan.updates).toEqual([{ id: 'reg-1', idNumber, idNumberHash: null }]);
  });
});
