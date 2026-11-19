import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { monthDays, dateKey, homeEvents } from '../utils/calendar.js'

const componentUrl = new URL('../components/QCalendar.vue', import.meta.url)
const componentSource = await readFile(componentUrl, 'utf8')
const script = componentSource.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace("import QIcon from './QIcon.vue'", 'const QIcon = {}')
  .replace("from '../utils/calendar.js'", `from '${new URL('../utils/calendar.js', componentUrl).href}'`)
const { default: calendar } = await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)

function mountCalendar(events) {
  const vm = { ...calendar.data(), events }
  for (const [name, method] of Object.entries(calendar.methods)) vm[name] = method.bind(vm)
  for (const [name, getter] of Object.entries(calendar.computed)) {
    Object.defineProperty(vm, name, { get: getter.bind(vm) })
  }
  return vm
}

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

test('月历默认预览两项，展开后保留同日各事项且切日重置', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 18) })
  const events = [
    { id: 'bill-1', date: '2026-11-18' },
    { id: 'repair-1', date: '2026-11-18' },
    { id: 'repair-2', date: '2026-11-18' },
    { id: 'bill-2', date: '2026-11-17' }
  ]
  const vm = mountCalendar(events)
  assert.equal(vm.extraCount, 1)
  assert.deepEqual(vm.visibleEvents.map(event => event.id), ['bill-1', 'repair-1'])
  assert.equal(vm.dayLabel(18), '11月18日，今天，3 项安排')
  vm.expanded = true
  assert.deepEqual(vm.visibleEvents.map(event => event.id), ['bill-1', 'repair-1', 'repair-2'])
  vm.select(17)
  assert.equal(vm.expanded, false)
  assert.equal(vm.extraCount, 0)
  assert.deepEqual(vm.visibleEvents.map(event => event.id), ['bill-2'])
  vm.select(18)
  assert.equal(vm.visibleEvents.length, 2)
})

test('翻月跨年后能回到今天，并恢复折叠和日期标记', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 11, 31) })
  const vm = mountCalendar([])
  vm.expanded = true
  vm.move(1)
  assert.equal(vm.selectedDate, '2027-01-01')
  assert.equal(vm.expanded, false)
  vm.goToToday()
  assert.equal(vm.selectedDate, '2026-12-31')
  assert.equal(vm.today, vm.selectedDate)
})

test('H5 指定日历按钮支持 Enter 和空格，长按不重复触发', () => {
  let clicks = 0, prevented = 0
  const target = { tagName: 'UNI-BUTTON', classList: { contains: name => name === 'calendar-button' }, click() { clicks++ } }
  const keydown = (key, repeat = false) => calendar.methods.handleCalendarKey({ target, key, repeat, preventDefault() { prevented++ } })
  keydown('Tab')
  keydown('Enter')
  keydown(' ')
  keydown(' ', true)
  assert.equal(clicks, 2)
  assert.equal(prevented, 3)
})
