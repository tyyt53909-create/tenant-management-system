import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isMaintenanceManager } from '../utils/session.js'

async function loadHome(name) {
  const url = new URL(`../components/home/${name}.vue`, import.meta.url)
  const source = await readFile(url, 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import (\w+) from '[^']+\.vue'/g, (_, component) => `const ${component} = {}`)
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, url).href}'`)
  return (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
}

function mountOptions(component, props = {}) {
  const vm = { ...component.data(), ...props }
  for (const [key, method] of Object.entries(component.methods)) vm[key] = method.bind(vm)
  for (const [key, getter] of Object.entries(component.computed)) {
    Object.defineProperty(vm, key, { get: getter.bind(vm) })
  }
  return vm
}

const [tenantHome, adminHome] = await Promise.all([loadHome('TenantHome'), loadHome('AdminHome')])
const page = (data, total = data.length, extra = {}) => ({ data, meta: { total, ...extra } })

function mockRequests(t, route) {
  const calls = []
  const navigation = []
  const original = globalThis.uni
  t.after(() => { globalThis.uni = original })
  globalThis.uni = {
    getStorageSync: () => 'local-test-session',
    showToast() {},
    navigateTo: ({ url }) => navigation.push(url),
    switchTab: ({ url }) => navigation.push(url),
    request(options) {
      const path = new URL(options.url).pathname.replace(/^\/api/, '')
      calls.push(path)
      const data = route(path, options.data)
      if (data === null) options.fail({ errMsg: 'network unavailable' })
      else options.success({ statusCode: 200, data })
    }
  }
  return { calls, navigation }
}

test('管理首页仅承接后端报修列表支持的管理角色', () => {
  assert.equal(isMaintenanceManager('ADMIN'), true)
  assert.equal(isMaintenanceManager('PROPERTY_MANAGER'), true)
  for (const role of ['MAINTAINER', 'FINANCIAL', 'OWNER', 'CLEANER', 'TENANT', undefined]) {
    assert.equal(isMaintenanceManager(role), false)
  }
})

test('租客待缴数使用分页总数，单笔进入账单详情', async t => {
  let total = 53
  const { navigation } = mockRequests(t, (path, { status }) => {
    if (path === '/notifications') return page([], 0, { unreadCount: 0 })
    return status === 'PENDING' ? page([{ id: 'bill-1' }], total) : page([])
  })
  const vm = mountOptions(tenantHome, { user: { capabilities: ['tenant.bill.read'] } })
  await vm.loadData()
  vm.openPendingBills()
  assert.equal(vm.pendingBillsCount, 53)
  assert.equal(navigation.at(-1), '/pages/bills/bills')
  total = 1
  await vm.loadData()
  vm.openPendingBills()
  assert.equal(vm.pendingBillsCount, 1)
  assert.equal(navigation.at(-1), '/packageA/bill-detail/bill-detail?id=bill-1')
})

test('租客局部读取失败时保留已有通知，仅有报修创建权限时仍可进入报修页', async t => {
  let available = true
  const { calls } = mockRequests(t, () => available ? page([{ id: 'notice' }], 1, { unreadCount: 1 }) : null)
  const vm = mountOptions(tenantHome, { user: { capabilities: ['tenant.maintenance.create'] } })
  await vm.loadData()
  available = false
  await vm.loadData()
  assert.deepEqual(calls, ['/notifications', '/notifications'])
  assert.deepEqual(vm.visibleServices.map(service => service.name), ['报修'])
  assert.deepEqual(vm.failed, ['通知'])
  assert.equal(vm.unreadCount, 1)
  assert.equal(vm.notices[0].id, 'notice')
})

test('管理工作台按工单状态汇总分页总量并保持当前筛选', async t => {
  mockRequests(t, (path, { status }) => {
    if (path === '/notifications/unread-count') return { unreadCount: 2 }
    const counts = { PENDING_CONFIRM: 3, SUBMITTED: 75, ACKNOWLEDGED: 22 }
    const task = { id: status, status, priority: status === 'SUBMITTED' ? 'URGENT' : 'NORMAL' }
    return counts[status] ? page([task], counts[status]) : page([])
  })
  const vm = mountOptions(adminHome)
  await vm.loadData()
  assert.deepEqual(vm.stats, { confirm: 3, pending: 97, assigned: 0 })
  assert.deepEqual(vm.filteredTasks.map(task => task.id), ['PENDING_CONFIRM', 'SUBMITTED', 'ACKNOWLEDGED'])
  vm.filterByStatus('pending')
  await vm.loadData()
  assert.equal(vm.currentFilter, 'pending')
  assert.deepEqual(vm.filteredTasks.map(task => task.id), ['SUBMITTED', 'ACKNOWLEDGED'])
})
