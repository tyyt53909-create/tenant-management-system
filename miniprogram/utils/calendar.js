export function monthDays(year, month) {
  const blanks = (new Date(year, month, 1).getDay() + 6) % 7
  return [...Array.from({ length: blanks }, () => 0), ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => i + 1)]
}
export function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
export function homeEvents(bills = [], repairs = []) {
  const events = bills.filter(b => b.dueDate && b.status !== 'CANCELLED').map(b => ({
    id: `bill-${b.id}`, recordId: b.id, date: b.dueDate.slice(0, 10), type: 'bill',
    title: b.status === 'PAID' ? '账单已缴清' : '账单缴付提醒',
    description: `${b.period || ''} · ¥${((b.amount || 0) / 100).toFixed(2)}`,
  }))
  return [...events, ...repairs.filter(r => r.createdAt && r.status !== 'CANCELLED').map(r => ({
    id: `repair-${r.id}`, recordId: r.id, date: r.createdAt.slice(0, 10), type: 'repair',
    title: r.title || '报修记录', description: '查看当前处理进度',
  }))]
}
