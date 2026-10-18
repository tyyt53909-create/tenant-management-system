import type { CheckoutItemType } from '@prisma/client';
import { CheckoutItemType as CheckoutItemTypeValues } from '@prisma/client';

/**
 * 退租结算项的两类分组，必须与 Prisma 的 `CheckoutItemType` 严格对齐。
 *
 * T207 修正：退租凭单原先把扣款侧写成
 * `['DAMAGE_COMPENSATION','CLEANING_FEE','OVERDUE_FEE','OTHER_DEDUCTION']` ——
 * 这四个值在 `CheckoutItemType` 里**都不存在**，于是 `totalDeduction` 恒为 0、
 * 实退净额被高估；退款侧又漏了 `UTILITY_REFUND`。
 *
 * 现在把分组声明为 `readonly CheckoutItemType[]`：写出不存在的类别名会直接编译失败，
 * 另配 `checkout-item-types.spec.ts` 断言两组**恰好划分**枚举（不重不漏）。
 */
export const CHECKOUT_DEDUCTION_TYPES: readonly CheckoutItemType[] = [
  'DEPOSIT_DEDUCTION',
  'OTHER_FEE',
];

export const CHECKOUT_REFUND_TYPES: readonly CheckoutItemType[] = [
  'RENT_REFUND',
  'DEPOSIT_REFUND',
  'UTILITY_REFUND',
  'OTHER_REFUND',
];

export function isDeductionItemType(type: string): boolean {
  return (CHECKOUT_DEDUCTION_TYPES as readonly string[]).includes(type);
}

export function isRefundItemType(type: string): boolean {
  return (CHECKOUT_REFUND_TYPES as readonly string[]).includes(type);
}

/** 仅用于测试与校验：枚举的全部取值。 */
export const ALL_CHECKOUT_ITEM_TYPES = Object.values(CheckoutItemTypeValues);
