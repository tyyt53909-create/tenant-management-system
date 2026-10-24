import {
  formatMoney,
  formatMoneyPlain,
  formatSignedMoney,
  centsToYuan,
  yuanToCents,
} from '@/utils/money';
import { formatDateOnly, formatDateTime } from '@/utils/table';

export function useMoney() {
  return {
    formatMoney,
    formatMoneyPlain,
    formatSignedMoney,
    centsToYuan,
    yuanToCents,
    formatDateOnly,
    formatDateTime,
  };
}
