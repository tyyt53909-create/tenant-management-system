import { formatMoneyPlain } from '@/utils/money';

export const rentDetailLabels = { PAYMENT: '收入 / 预付抵扣', REFUND: '成功退款', CORRECTION: '更正' } as const;
export function rentPrincipal(amount: number | null): string {
  return amount === null ? '待核对' : `¥${formatMoneyPlain(amount)}`;
}
