import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthDays, dateKey, homeEvents } from '../utils/calendar.js'

test('月历以周一开始，支持闰年与日期补零', () => {
  assert.deepEqual(monthDays(2026, 9).slice(0, 4), [0, 0, 0, 1])
  assert.equal(monthDays(2028, 1).filter(Boolean).length, 29)
  assert.equal(dateKey(2027, 0, 3), '2027-01-03')
})
test('生活月历仅来自真实账单与工单，并排除取消记录', () => {
  const events = homeEvents([{ id: 'a', status: 'PENDING', amount: 12345, dueDate: '2026-10-18T00:00:00Z' }, { id: 'b', status: 'CANCELLED', dueDate: '2026-10-18' }], [{ id: 'r', title: '漏水', createdAt: '2026-10-13T00:00:00Z' }])
  assert.equal(events.length, 2)
  assert.equal(events[0].date, '2026-10-18')
  assert.match(events[0].description, /123\.45/)
  assert.equal(events[1].recordId, 'r')
})
