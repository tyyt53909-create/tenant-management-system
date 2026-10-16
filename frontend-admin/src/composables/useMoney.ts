import { formatMoney, centsToYuan, formatDateOnly, formatDateTime } from '@/utils/table';

export function useMoney() {
  const yuanToCents = (yuan: unknown): number => {
    return Math.round((Number(yuan) || 0) * 100);
  };

  return {
    formatMoney,
    centsToYuan,
    yuanToCents,
    formatDateOnly,
    formatDateTime,
  };
}
