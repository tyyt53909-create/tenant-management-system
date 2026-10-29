export interface BalanceMovement { id: string; type: string; amount: number; balanceAfter: number; createdAt: Date }

/** A timestamp tie does not establish an ordering, so never infer one from an ID. */
export function verifyBalance(kind: 'deposit' | 'prepay', balance: number, movements: BalanceMovement[]): string[] {
  const reasons: string[] = ['历史流水完整性无法证明'];
  if (movements.length === 0) reasons.push('无流水，无法核实来源');
  if (!Number.isSafeInteger(balance)) reasons.push('账面余额不是安全整数');
  if (balance < 0) reasons.push('账面余额为负数');
  let previous = 0;
  for (let i = 0; i < movements.length; i++) {
    const row = movements[i];
    if (!Number.isSafeInteger(row.amount) || !Number.isSafeInteger(row.balanceAfter)) { reasons.push('流水金额不是安全整数'); break; }
    if (i && row.createdAt.getTime() <= movements[i - 1].createdAt.getTime()) { reasons.push('流水时间相同或顺序不明确'); break; }
    const allowed = kind === 'deposit'
      ? (row.type === 'COLLECT' ? row.amount > 0 : ['REFUND', 'DEDUCT', 'REVERSAL'].includes(row.type) ? row.amount < 0 : row.type === 'TRANSFER' && row.amount !== 0)
      : (row.type === 'RECHARGE' ? row.amount > 0 : ['DEDUCTION', 'REFUND'].includes(row.type) ? row.amount < 0 : row.type === 'ADJUSTMENT' && row.amount !== 0);
    if (!allowed) { reasons.push('流水类型或金额方向异常'); break; }
    const next = previous + row.amount;
    if (!Number.isSafeInteger(next) || next !== row.balanceAfter || next < 0) { reasons.push('流水从零起的余额链不一致或为负'); break; }
    previous = next;
  }
  if (previous !== balance) reasons.push('流水合计与账面余额不一致');
  return [...new Set(reasons)];
}
