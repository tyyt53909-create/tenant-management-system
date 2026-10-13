/**
 * 展示层格式化工具（T162）
 *
 * 背景：页面里常见 `{{ value || '-' }}㎡` 这类写法，有两个问题：
 * 1. 值为空时输出「-㎡」——挂了单位却没有值（合同页面积就显示成「-㎡」）
 * 2. `||` 会把 0 当空值：楼层 0、面积 0 是合法值，却会被显示成「-」
 *
 * 因此统一用显式判空（null / undefined / 空串），保留 0。
 */

/** 值是否为空（注意：0 与 false 不算空） */
export function isEmpty(value) {
  return value === null || value === undefined || value === ''
}

/** 空值 → '—'，否则原样返回（0 保留） */
export function orDash(value) {
  return isEmpty(value) ? '—' : value
}

/** 带单位：有值 → '25.5㎡'；无值 → '—'（不会出现「-㎡」） */
export function withUnit(value, unit, digits) {
  if (isEmpty(value)) return '—'
  const num = Number(value)
  if (Number.isNaN(num)) return '—'
  const text = typeof digits === 'number' ? num.toFixed(digits) : String(num)
  return text + unit
}

/** 分 → '¥1,000.00'；空值 → '—' */
export function money(cents) {
  if (isEmpty(cents)) return '—'
  const n = Number(cents)
  if (Number.isNaN(n)) return '—'
  return (
    '¥' + (n / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
}

/** 长编号等：超长时中间省略，避免撑破卡片 */
export function shortenMiddle(text, head = 14, tail = 6) {
  const s = String(text ?? '')
  if (s.length <= head + tail + 1) return s
  return s.slice(0, head) + '…' + s.slice(-tail)
}
