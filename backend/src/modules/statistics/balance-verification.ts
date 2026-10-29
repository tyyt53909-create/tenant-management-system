export interface BalanceMovement { id: string; type: string; amount: number; balanceAfter: number; createdAt: Date }
export type BalanceReasonCode = 'HISTORY_UNPROVEN' | 'NO_MOVEMENTS' | 'NEGATIVE_BALANCE' | 'UNSAFE_VALUE' | 'ORDER_UNKNOWN' | 'INVALID_DIRECTION' | 'CHAIN_MISMATCH' | 'TOTAL_MISMATCH' | 'TRANSFER_PAIR_UNPROVEN';
export interface BalanceCheck { arithmetic: 'consistent' | 'inconsistent' | 'unknown'; total: number | null; codes: BalanceReasonCode[]; reasons: string[] }
const messages: Record<BalanceReasonCode, string> = {
  HISTORY_UNPROVEN: '历史流水完整性无法证明', NO_MOVEMENTS: '无流水，无法核实来源', NEGATIVE_BALANCE: '账面余额为负数', UNSAFE_VALUE: '金额不是安全整数，无法计算完整总和', ORDER_UNKNOWN: '流水时间相同或顺序不明确', INVALID_DIRECTION: '流水类型或金额方向异常', CHAIN_MISMATCH: '逐笔余额链不一致', TOTAL_MISMATCH: '完整流水总和与账面余额不一致', TRANSFER_PAIR_UNPROVEN: '押金转移配对未核实，需追溯原始关联',
};
export function verifyBalance(kind: 'deposit' | 'prepay', balance: number, movements: BalanceMovement[]): BalanceCheck {
  const codes = new Set<BalanceReasonCode>(['HISTORY_UNPROVEN']);
  if (!movements.length) codes.add('NO_MOVEMENTS');
  if (balance < 0) codes.add('NEGATIVE_BALANCE');
  if (kind === 'deposit' && movements.some(row => row.type === 'TRANSFER')) codes.add('TRANSFER_PAIR_UNPROVEN');
  let total: number | null = 0; let directionValid = true; let orderKnown = true; let chainValid = true; let previous = 0;
  if (!Number.isSafeInteger(balance)) { codes.add('UNSAFE_VALUE'); total = null; }
  for (let i = 0; i < movements.length; i++) {
    const row = movements[i];
    if (!Number.isSafeInteger(row.amount) || !Number.isSafeInteger(row.balanceAfter)) { codes.add('UNSAFE_VALUE'); total = null; }
    if (total !== null) { const next = total + row.amount; total = Number.isSafeInteger(next) ? next : null; if (total === null) codes.add('UNSAFE_VALUE'); }
    const allowed = kind === 'deposit'
      ? (row.type === 'COLLECT' ? row.amount > 0 : ['REFUND', 'DEDUCT', 'REVERSAL'].includes(row.type) ? row.amount < 0 : row.type === 'TRANSFER' && row.amount !== 0)
      : (row.type === 'RECHARGE' ? row.amount > 0 : ['DEDUCTION', 'REFUND'].includes(row.type) ? row.amount < 0 : row.type === 'ADJUSTMENT' && row.amount !== 0);
    const knownType = kind === 'deposit' ? ['COLLECT', 'REFUND', 'DEDUCT', 'REVERSAL', 'TRANSFER'].includes(row.type) : ['RECHARGE', 'DEDUCTION', 'REFUND', 'ADJUSTMENT'].includes(row.type);
    if (!knownType || (Number.isSafeInteger(row.amount) && !allowed)) directionValid = false;
    if (!Number.isFinite(row.createdAt.getTime()) || (i > 0 && row.createdAt.getTime() <= movements[i - 1].createdAt.getTime())) orderKnown = false;
  }
  if (!directionValid) codes.add('INVALID_DIRECTION');
  if (!orderKnown) codes.add('ORDER_UNKNOWN');
  if (orderKnown && total !== null) {
    for (const row of movements) { const next = previous + row.amount; if (!Number.isSafeInteger(next) || next !== row.balanceAfter) { chainValid = false; break; } previous = next; }
    if (!chainValid) codes.add('CHAIN_MISMATCH');
  }
  if (total !== null && total !== balance) codes.add('TOTAL_MISMATCH');
  const arithmetic = !directionValid || (total !== null && total !== balance) || !chainValid ? 'inconsistent' : (!movements.length || !orderKnown || total === null ? 'unknown' : 'consistent');
  const list = [...codes];
  return { arithmetic, total, codes: list, reasons: list.map(code => messages[code]) };
}
