/**
 * 表格常用格式化（T160 UI 优化）
 *
 * 关于排序：本模块**故意不提供 sort-method 工具**。
 * 原因（2026-10-13 踩坑记录）：Element Plus 传给 sort-method 的入参形态
 * 会随列的 sort-by 配置变化（配了 sort-by 传 { value }，没配传整行对象），
 * 极易写成 `Number(row)` → NaN → 比较器恒返回 0 → 表格「点表头没反应」。
 *
 * 而本项目所有可排序列用内置排序即可得到正确结果：
 * - 金额字段为整数（分）→ 数值比较正确
 * - 日期字段后端一律返回完整 ISO 串（已核验 200 条 0 例外）→ 字典序 == 时间序
 * 因此统一用 `sortable sort-by="<字段名>"`，不写 sort-method。
 */

/** 分 → 「¥1,234.56」（带千分位，金额较大时更易读） */
export const formatMoney = (cents: unknown): string => {
  const n = Number(cents) || 0;
  return (
    '¥' +
    (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
};

/** 分 → 「1234.56」（不带符号，用于表单项） */
export const centsToYuan = (cents: unknown): number => {
  return Number(((Number(cents) || 0) / 100).toFixed(2));
};

/** 取日期部分：ISO 串 → 「2026-10-23」；空值 → 「—」 */
export const formatDateOnly = (value: unknown): string => {
  if (!value) return '—';
  return String(value).split('T')[0];
};

/** ISO 串 → 「2026-10-23 14:30」；空值 → 「—」 */
export const formatDateTime = (value: unknown): string => {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 16);
};
