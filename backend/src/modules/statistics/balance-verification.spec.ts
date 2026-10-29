import { describe, expect, it } from 'vitest';
import { verifyBalance } from './balance-verification.js';
const row = (type: string, amount: number, balanceAfter: number, time: string) => ({ id: time, type, amount, balanceAfter, createdAt: new Date(time) });
describe('余额流水核对', () => {
  it('从零检查收取和转出，不把转移当作新增余额', () => {
    expect(verifyBalance('deposit', 0, [row('COLLECT', 100, 100, '2026-01-01'), row('TRANSFER', -100, 0, '2026-01-02')])).toEqual(['历史流水完整性无法证明']);
    expect(verifyBalance('deposit', 100, [row('TRANSFER', 100, 100, '2026-01-03')])).toEqual(['历史流水完整性无法证明']);
  });
  it('零余额无流水仍无法核实来源', () => expect(verifyBalance('prepay', 0, [])).toContain('无流水，无法核实来源'));
  it('对缺失历史、时间并列、方向错误与负余额不猜测', () => {
    expect(verifyBalance('prepay', 100, [row('RECHARGE', 50, 100, '2026-01-01')])).not.toEqual([]);
    expect(verifyBalance('prepay', 0, [row('RECHARGE', 10, 10, '2026-01-01'), row('DEDUCTION', -10, 0, '2026-01-01')])).not.toEqual([]);
    expect(verifyBalance('prepay', -1, [row('ADJUSTMENT', -1, -1, '2026-01-01')])).not.toEqual([]);
    expect(verifyBalance('deposit', 10, [row('REFUND', 10, 10, '2026-01-01')])).not.toEqual([]);
  });
});
