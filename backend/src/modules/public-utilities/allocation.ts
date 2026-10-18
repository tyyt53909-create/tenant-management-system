/**
 * 公共水电分摊（T217）。
 *
 * 规则：按「计费月内生效中的合同所覆盖房间」的建筑面积占比分摊。
 * 金额以分为单位整数运算；每笔向下取整后，余额补给分摊基数最大的一笔，
 * 保证分摊合计恰好等于单据总额（不多收也不漏收）。
 */
export interface AllocationBase {
  contractId: string;
  roomId: string;
  /** 建筑面积 ×100 取整，避免浮点比较 */
  baseAreaHundredths: number;
}

export interface AllocationEntry extends AllocationBase {
  amount: number;
}

export function allocateByArea(totalAmount: number, bases: AllocationBase[]): AllocationEntry[] {
  if (totalAmount <= 0 || bases.length === 0) {
    return bases.map((base) => ({ ...base, amount: 0 }));
  }
  const totalBase = bases.reduce((sum, base) => sum + base.baseAreaHundredths, 0);
  if (totalBase <= 0) {
    return bases.map((base) => ({ ...base, amount: 0 }));
  }

  const entries = bases.map((base) => ({
    ...base,
    amount: Math.floor((totalAmount * base.baseAreaHundredths) / totalBase),
  }));

  const remainder = totalAmount - entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (remainder > 0) {
    let target = 0;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].baseAreaHundredths > entries[target].baseAreaHundredths) target = i;
    }
    entries[target].amount += remainder;
  }
  return entries;
}
