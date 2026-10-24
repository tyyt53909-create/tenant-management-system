/**
 * 金额格式化唯一入口（FIN-10 / T275）。
 *
 * 后端金额一律是「分」整数；前端不得再手写 `/ 100` 或 `* 100`。
 * - 表格/卡片展示用 `formatMoney`（带 ¥ 与千分位）
 * - 表单回填与二次计算用 `centsToYuan` / `yuanToCents`
 * - CSV 或纯数字场景用 `formatMoneyPlain`
 */
export function yuanToCents(yuan: unknown): number {
  const value = Number(yuan);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function centsToYuan(cents: unknown): number {
  const value = Number(cents);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value) / 100;
}

/** 分 → 「1234.56」 */
export function formatMoneyPlain(cents: unknown): string {
  return centsToYuan(cents).toFixed(2);
}

/** 分 → 「¥1,234.56」 */
export function formatMoney(cents: unknown): string {
  const yuan = centsToYuan(cents);
  const body = Math.abs(yuan).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${yuan < 0 ? '-' : ''}¥${body}`;
}

/** 分 → 「+¥1.00」/「-¥1.00」；0 为「¥0.00」。 */
export function formatSignedMoney(cents: unknown): string {
  const value = Math.round(Number(cents));
  if (!Number.isFinite(value) || value === 0) return formatMoney(0);
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}
