/**
 * 金额格式化唯一入口（FIN-10 / T275；QLT-04 / T289 起算法本体在 shared/src/money.ts）。
 *
 * 后端金额一律是「分」整数；前端不得再手写 `/ 100` 或 `* 100`。
 * - 表格/卡片展示用 `formatMoney`（带 ¥ 与千分位）
 * - 表单回填与二次计算用 `centsToYuan` / `yuanToCents`
 * - CSV 或纯数字场景用 `formatMoneyPlain`
 */
export {
  yuanToCents,
  centsToYuan,
  centsToYuanString as formatMoneyPlain,
  formatCents as formatMoney,
  formatSignedCents as formatSignedMoney,
} from '../../../shared/src/money.js';
