import { describe, expect, it } from 'vitest';
import { verifyBalance } from './balance-verification.js';
const row = (type: string, amount: number, balanceAfter: number, time: string) => ({ id: time, type, amount, balanceAfter, createdAt: new Date(time) });
describe('余额流水核对', () => {
  it('同时间相抵时总和为零、顺序未知且不误报总额不一致', () => {
    const result = verifyBalance('prepay', 0, [row('RECHARGE', 100, 100, '2026-01-01'), row('DEDUCTION', -100, 0, '2026-01-01')]);
    expect(result).toMatchObject({ arithmetic: 'unknown', total: 0 }); expect(result.codes).toContain('ORDER_UNKNOWN'); expect(result.codes).not.toContain('TOTAL_MISMATCH');
  });
  it('同时间不掩盖已知方向及总额错误', () => {
    const result = verifyBalance('prepay', 7, [row('RECHARGE', 100, 100, '2026-01-01'), row('DEDUCTION', 1, 101, '2026-01-01')]);
    expect(result).toMatchObject({ arithmetic: 'inconsistent', total: 101 }); expect(result.codes).toEqual(expect.arrayContaining(['ORDER_UNKNOWN', 'INVALID_DIRECTION', 'TOTAL_MISMATCH']));
  });
  it('允许负调整，负账面需核对但算术可一致', () => {
    const result = verifyBalance('prepay', -1, [row('ADJUSTMENT', -1, -1, '2026-01-01')]); expect(result).toMatchObject({ arithmetic: 'consistent', total: -1 }); expect(result.codes).toContain('NEGATIVE_BALANCE');
  });
  it('危险整数不输出虚假总和；零余额无流水未知', () => {
    expect(verifyBalance('prepay', 0, [row('RECHARGE', Number.MAX_SAFE_INTEGER + 1, 0, '2026-01-01')])).toMatchObject({ arithmetic: 'unknown', total: null, codes: expect.arrayContaining(['UNSAFE_VALUE']) });
    expect(verifyBalance('prepay', 0, [])).toMatchObject({ arithmetic: 'unknown', codes: expect.arrayContaining(['NO_MOVEMENTS']) });
    expect(verifyBalance('prepay', 100, [])).toMatchObject({ arithmetic: 'inconsistent', total: 0, codes: expect.arrayContaining(['NO_MOVEMENTS', 'TOTAL_MISMATCH']) });
  });
  it('转移配对需追溯，逐笔链差异单独标记', () => {
    expect(verifyBalance('deposit', 100, [row('TRANSFER', 100, 100, '2026-01-01')])).toMatchObject({ arithmetic: 'consistent', codes: expect.arrayContaining(['TRANSFER_PAIR_UNPROVEN']) });
    expect(verifyBalance('deposit', 100, [row('COLLECT', 100, 90, '2026-01-01')])).toMatchObject({ arithmetic: 'inconsistent', total: 100, codes: expect.arrayContaining(['CHAIN_MISMATCH']) });
  });
});
