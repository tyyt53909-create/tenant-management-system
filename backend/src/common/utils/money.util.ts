/**
 * 金额换算（FIN-10 / T275）。
 *
 * 全库金额一律以「分」整数存储；本文件是「元 ↔ 分」与展示字符串的唯一入口。
 * 禁止在业务代码里直接 `x / 100` 或 `x * 100`，避免浮点误差与格式漂移。
 */

/** 元 → 分；四舍五入到整数分。 */
export function yuanToCents(yuan: unknown): number {
  const value = Number(yuan);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/** 分 → 元（数值，保留两位精度）；用于表单回填与二次计算。 */
export function centsToYuan(cents: unknown): number {
  const value = Number(cents);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value) / 100;
}

/** 分 → 「1234.56」（不带货币符号，固定两位小数）。 */
export function centsToYuanString(cents: unknown): string {
  return centsToYuan(cents).toFixed(2);
}

/** 分 → 「¥1,234.56」（千分位，供只读展示；CSV 用 `centsToYuanString`）。 */
export function formatCents(cents: unknown): string {
  const yuan = centsToYuan(cents);
  const body = Math.abs(yuan).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${yuan < 0 ? '-' : ''}¥${body}`;
}

/** 分 → 「+¥1.00」/「-¥1.00」；0 显示「¥0.00」。 */
export function formatSignedCents(cents: unknown): string {
  const value = Math.round(Number(cents));
  if (!Number.isFinite(value) || value === 0) return formatCents(0);
  return `${value > 0 ? '+' : '-'}${formatCents(Math.abs(value))}`;
}

/** 一组分值的合计；忽略非数字。 */
export function sumCents(values: Array<number | null | undefined>): number {
  return values.reduce<number>((sum, value) => {
    const n = Number(value);
    return sum + (Number.isFinite(n) ? Math.round(n) : 0);
  }, 0);
}
