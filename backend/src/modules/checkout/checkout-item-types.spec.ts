import { describe, expect, it } from 'vitest';
import {
  ALL_CHECKOUT_ITEM_TYPES,
  CHECKOUT_DEDUCTION_TYPES,
  CHECKOUT_REFUND_TYPES,
  isDeductionItemType,
  isRefundItemType,
} from './checkout-item-types.js';

describe('退租结算项类别分组', () => {
  /**
   * 回归 T207：原先扣款侧列了四个 Prisma 枚举里不存在的值（DAMAGE_COMPENSATION /
   * CLEANING_FEE / OVERDUE_FEE / OTHER_DEDUCTION），退款侧又漏了 UTILITY_REFUND，
   * 导致凭单的 totalDeduction 恒为 0。这条断言要求两组恰好划分枚举 —— 不重、不漏。
   */
  it('扣款组与退款组恰好划分 CheckoutItemType（不重不漏）', () => {
    const covered = [...CHECKOUT_DEDUCTION_TYPES, ...CHECKOUT_REFUND_TYPES];

    // 不重叠
    expect(new Set(covered).size).toBe(covered.length);
    // 完全覆盖
    expect([...covered].sort()).toEqual([...ALL_CHECKOUT_ITEM_TYPES].sort());
  });

  it('类别判定与分组一致', () => {
    for (const type of ALL_CHECKOUT_ITEM_TYPES) {
      expect(isDeductionItemType(type)).toBe(CHECKOUT_DEDUCTION_TYPES.includes(type));
      expect(isRefundItemType(type)).toBe(CHECKOUT_REFUND_TYPES.includes(type));
      // 每个类别必然属于两组之一，不会既不是扣款也不是退款
      expect(isDeductionItemType(type) || isRefundItemType(type)).toBe(true);
    }
  });

  it('押金扣除与其他费用计入扣款，水电余额退还计入退款', () => {
    expect(isDeductionItemType('DEPOSIT_DEDUCTION')).toBe(true);
    expect(isDeductionItemType('OTHER_FEE')).toBe(true);
    expect(isRefundItemType('UTILITY_REFUND')).toBe(true);
    expect(isRefundItemType('DEPOSIT_DEDUCTION')).toBe(false);
  });
});
