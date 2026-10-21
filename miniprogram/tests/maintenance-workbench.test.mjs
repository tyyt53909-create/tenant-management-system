import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import request from '../utils/request.js'
import {
  getWorkbenchOrders,
  getWorkbenchOrder,
  claimMaintenance,
  completeMaintenance,
  releaseMaintenance,
} from '../api/index.js'
import { openHome, ensureSession, ensureTenantSession } from '../utils/session.js'

// 直接执行真实 Options API 脚本（与 cleaning.test.mjs 相同的加载方式）。
async function loadPage(path) {
  const url = new URL(path, import.meta.url)
  const source = await readFile(url, 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import (\w+) from '[^']+\.vue'/g, (_, name) => `const ${name} = {}`)
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, url).href}'`)
  return (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
}

const workbenchPage = await loadPage('../pages/maintenance/workbench.vue')
const detailPage = await loadPage('../pages/maintenance/detail.vue')
const loginPage = await loadPage('../pages/login/login.vue')
const homePage = await loadPage('../pages/maintenance/home.vue')
const settingsPage = await loadPage('../pages/maintenance/settings.vue')

function instance(page) {
  const vm = page.data()
  for (const [key, method] of Object.entries(page.methods)) vm[key] = method.bind(vm)
  for (const [key, getter] of Object.entries(page.computed || {})) {
    Object.defineProperty(vm, key, { get: () => getter.call(vm) })
  }
  return vm
}

let storage, calls, navigation, replies, toasts, modalConfirm, previewed
beforeEach(() => {
  storage = new Map([['access_token', 'unit-test-token']])
  calls = []; navigation = []; replies = []; toasts = []; modalConfirm = true; previewed = null
  globalThis.uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    reLaunch: options => navigation.push(options.url),
    switchTab: options => navigation.push(options.url),
    navigateTo: options => navigation.push(options.url),
    showToast: options => toasts.push(options.title),
    showModal: options => options.success({ confirm: modalConfirm }),
    previewImage: options => { previewed = options },
    setNavigationBarTitle: () => {},
    stopPullDownRefresh: () => {},
    request: options => {
      calls.push(options)
      const reply = replies.shift()
      assert.ok(reply, `Unexpected request: ${options.url}`)
      if (reply.fail) options.fail(new Error('offline'))
      else options.success({ statusCode: reply.status || 200, data: reply.data })
    },
  }
})

const order = {
  id: 'mr-1',
  title: '厨房水槽漏水',
  description: '柜子下面一直滴水',
  category: 'PLUMBING',
  priority: 'URGENT',
  status: 'ASSIGNED',
  assignedTo: null,
  assignedAt: null,
  resolution: null,
  createdAt: '2026-10-21T09:00:00.000Z',
  room: { id: 'room-1', roomNumber: '101', floor: 3, building: { name: 'A栋' } },
  photos: [{ id: 'p1', fileUrl: '/api/files/a.jpg' }],
  // 后端工作台投影不应返回以下字段；即便返回，页面投影也必须丢弃。
  tenant: { name: 'PRIVATE', phone: '13800000000' },
  tenantId: 'tenant-private',
}
const list = (data = [order], page = 1, totalPages = 1) => ({
  data,
  meta: { page, totalPages, total: data.length },
})
const detail = (overrides = {}) => ({ ...order, ...overrides })
const ready = () => {
  const vm = instance(workbenchPage)
  vm.authorized = true
  vm.view = 'pool'
  vm.orders = [{ id: 'mr-1', title: '厨房水槽漏水', isPool: true, status: 'ASSIGNED' }]
  return vm
}

test('维修 API：列表、详情、接单与完工路径正确', async () => {
  replies.push({ data: {} }, { data: {} }, { data: {} }, { data: {} }, { data: {} })
  await getWorkbenchOrders({ view: 'pool', page: 1, limit: 20 })
  await getWorkbenchOrder('a/b')
  await claimMaintenance('a/b')
  await completeMaintenance('c/d', { resolution: '已修好' })
  await releaseMaintenance('e/f')

  assert.ok(calls[0].url.includes('/maintenance/workbench'))
  assert.deepEqual(calls[0].data, { view: 'pool', page: 1, limit: 20 })
  assert.ok(calls[1].url.endsWith('/maintenance/workbench/a%2Fb'))
  assert.equal(calls[2].method, 'PATCH')
  assert.ok(calls[2].url.endsWith('/maintenance/a%2Fb/claim'))
  assert.equal(calls[3].method, 'PATCH')
  assert.ok(calls[3].url.endsWith('/maintenance/c%2Fd/complete'))
  assert.deepEqual(calls[3].data, { resolution: '已修好' })
  assert.equal(calls[4].method, 'PATCH')
  assert.ok(calls[4].url.endsWith('/maintenance/e%2Ff/release'))
})

test('维修角色进入维修首页，不进入租客首页', () => {
  openHome('MAINTENANCE')
  openHome('CLEANER')
  openHome('TENANT')
  assert.deepEqual(navigation, [
    '/pages/maintenance/home',
    '/pages/cleaning/home',
    '/pages/index/index',
  ])
})

test('工单筛选与关键字只作为查询条件提交', async () => {
  const vm = instance(workbenchPage)
  vm.activeFilter = 'urgent'
  vm.keyword = '  101  '
  replies.push({ data: list([]) })
  await vm.fetchPage(1)

  assert.deepEqual(calls[0].data, {
    view: 'pool', page: 1, limit: 20, priority: 'URGENT', keyword: '101',
  })
})

test('取消筛选恢复全部条件', async () => {
  const vm = instance(workbenchPage)
  vm.activeFilter = 'PLUMBING'
  vm.keyword = '水槽'
  replies.push({ data: { role: 'MAINTENANCE' } }, { data: list([]) })
  await vm.clearFilters()

  assert.equal(vm.activeFilter, 'all')
  assert.equal(vm.keyword, '')
  assert.equal(calls[1].data.category, undefined)
  assert.equal(calls[1].data.keyword, undefined)
})

test('维修会话不会被当作租客放行', async () => {
  replies.push({ data: { role: 'MAINTENANCE' } })
  const allowed = await ensureTenantSession()
  assert.equal(allowed, false)
  assert.deepEqual(navigation, ['/pages/maintenance/home'])
})

test('维修首页汇总三类工单并进入对应视图', async () => {
  replies.push(
    { data: { id: 'maint-1', role: 'MAINTENANCE' } },
    { data: { data: [order], meta: { total: 2 } } },
    { data: { data: [], meta: { total: 1 } } },
    { data: { data: [], meta: { total: 3 } } },
    { data: { unreadCount: 2 } },
  )
  const vm = instance(homePage)
  await vm.load()

  assert.deepEqual(vm.counts, { pool: 2, active: 1, done: 3 })
  assert.equal(vm.recent.length, 1)
  assert.equal(vm.unreadCount, 2)
  assert.equal(vm.greeting.length > 0, true)

  vm.goWork('active')
  assert.deepEqual(navigation, ['/pages/maintenance/workbench?view=active'])
})

test('维修设置页读取账号与未读，并可进入主题设置', async () => {
  replies.push(
    { data: { id: 'maint-1', email: 'maint@example.com', role: 'MAINTENANCE' } },
    { data: { unreadCount: 4 } },
  )
  const vm = instance(settingsPage)
  await vm.load()

  assert.equal(vm.email, 'maint@example.com')
  assert.equal(vm.initial, 'M')
  assert.equal(vm.unreadCount, 4)

  vm.goTheme()
  assert.deepEqual(navigation, ['/pages/theme/theme'])
})

test('通知中心对所有已登录角色开放，不把维修人员送回工作台', async () => {
  replies.push({ data: { role: 'MAINTENANCE' } })
  const user = await ensureSession()
  assert.equal(user.role, 'MAINTENANCE')
  assert.equal(storage.get('user_role'), 'MAINTENANCE')
  assert.deepEqual(navigation, [])
})

test('员工激活：角色邀请码注册后直接进入维修工作台', async () => {  replies.push({
    data: {
      accessToken: 'staff-access',
      refreshToken: 'staff-refresh',
      user: { id: 'maint-1', email: 'maint@example.com', role: 'MAINTENANCE' },
    },
  })
  const vm = instance(loginPage)
  vm.staffForm = { email: 'maint@example.com', password: 'secret1', inviteCode: 'INVITE-MAINT' }
  await vm.handleStaffActivate()

  assert.ok(calls[0].url.endsWith('/auth/register'))
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].data, {
    email: 'maint@example.com',
    password: 'secret1',
    inviteCode: 'INVITE-MAINT',
  })
  assert.equal(storage.get('user_role'), 'MAINTENANCE')
  assert.equal(storage.get('access_token'), 'staff-access')
  assert.deepEqual(navigation, ['/pages/maintenance/home'])
})

test('工作台只保留维修所需字段，不泄露租客资料', async () => {
  replies.push({ data: { role: 'MAINTENANCE' } }, { data: list() })
  const vm = instance(workbenchPage)
  await vm.refresh()

  assert.equal(vm.authorized, true)
  assert.equal(vm.orders.length, 1)
  assert.deepEqual(Object.keys(vm.orders[0]).sort(), [
    'assignedTo', 'buildingName', 'category', 'createdAt', 'description', 'floor',
    'id', 'isPool', 'photoCount', 'priority', 'roomId', 'roomNumber', 'status', 'title',
  ])
  assert.ok(!JSON.stringify(vm.orders).includes('PRIVATE'))
  assert.ok(!JSON.stringify(vm.orders).includes('13800000000'))
})

test('非维修角色打开工作台会被送回自己的首页', async () => {
  replies.push({ data: { role: 'TENANT' } })
  const vm = instance(workbenchPage)
  await vm.refresh()

  assert.equal(vm.authorized, false)
  assert.equal(vm.orders.length, 0)
  assert.deepEqual(navigation, ['/pages/index/index'])
})

test('维修工单可带房间进入上报页', () => {
  const vm = instance(workbenchPage)
  vm.reportIssue({ roomId: 'room-1', roomNumber: '101', buildingName: 'A栋' })
  assert.deepEqual(navigation, ['/pages/staff-report/report?roomId=room-1&roomName=101&buildingName=A%E6%A0%8B'])
})

test('接单成功后重新拉取列表，避免显示过期状态', async () => {
  const vm = ready()
  replies.push({ data: { id: 'mr-1', status: 'IN_PROGRESS' } }, { data: list([]) })
  await vm.claim(vm.orders[0])

  assert.equal(calls[0].method, 'PATCH')
  assert.ok(calls[0].url.endsWith('/maintenance/mr-1/claim'))
  assert.equal(vm.orders.length, 0)
  assert.equal(vm.busyId, '')
  assert.ok(toasts.includes('已接单，开始处理'))
})

test('接单冲突提示已被他人接单并刷新，不自动重试', async () => {
  const vm = ready()
  replies.push({ status: 409, data: { message: '已被接单' } }, { data: list([]) })
  await vm.claim(vm.orders[0])

  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1)
  assert.ok(vm.error.includes('其他维修人员'))
  assert.equal(vm.orders.length, 0)
})

test('取消接单不发请求', async () => {
  modalConfirm = false
  const vm = ready()
  await vm.claim(vm.orders[0])
  assert.equal(calls.length, 0)
  assert.equal(vm.busyId, '')
})

test('详情页复用租客报修进度页，按维修角色映射房间与照片', async () => {
  replies.push({ data: { role: 'MAINTENANCE' } }, { data: detail() })
  const vm = instance(detailPage)
  vm.id = 'mr-1'
  await vm.load()

  assert.equal(vm.isMaintenance, true)
  assert.equal(vm.record.room.roomNumber, '101')
  assert.equal(vm.record.room.building.name, 'A栋')
  assert.equal(vm.record.photos.length, 1)
  assert.equal(vm.record.status, 'ASSIGNED')
  assert.equal(vm.priority, '紧急')
})

test('完工结果为空时拒绝提交', async () => {
  replies.push({ data: { role: 'MAINTENANCE' } }, { data: detail({ status: 'IN_PROGRESS', assignedTo: 'maint-1' }) })
  const vm = instance(detailPage)
  vm.id = 'mr-1'
  await vm.load()

  vm.resolution = '   '
  await vm.submitComplete()

  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0)
  assert.ok(toasts.includes('请填写处理结果'))
})

test('退回公共池后重新加载为待接单', async () => {
  replies.push(
    { data: { role: 'MAINTENANCE' } },
    { data: detail({ status: 'IN_PROGRESS', assignedTo: 'maint-1' }) },
    { data: { id: 'mr-1', status: 'ASSIGNED' } },
    { data: { role: 'MAINTENANCE' } },
    { data: detail({ status: 'ASSIGNED', assignedTo: null }) },
  )
  const vm = instance(detailPage)
  vm.id = 'mr-1'
  await vm.load()

  await vm.releaseOrder()

  const patch = calls.find(call => call.method === 'PATCH')
  assert.ok(patch.url.endsWith('/maintenance/mr-1/release'))
  assert.equal(vm.record.status, 'ASSIGNED')
  assert.equal(vm.record.assignedTo, null)
  assert.ok(toasts.includes('已退回公共池'))
})

test('完工提交去除首尾空格并刷新为待确认', async () => {
  replies.push(
    { data: { role: 'MAINTENANCE' } },
    { data: detail({ status: 'IN_PROGRESS', assignedTo: 'maint-1' }) },
    { data: { id: 'mr-1', status: 'PENDING_CONFIRM' } },
    { data: { role: 'MAINTENANCE' } },
    { data: detail({ status: 'PENDING_CONFIRM', assignedTo: 'maint-1', resolution: '已更换水龙头' }) },
  )
  const vm = instance(detailPage)
  vm.id = 'mr-1'
  await vm.load()

  vm.resolution = '  已更换水龙头  '
  await vm.submitComplete()

  const patch = calls.find(call => call.method === 'PATCH')
  assert.deepEqual(patch.data, { resolution: '已更换水龙头' })
  assert.ok(patch.url.endsWith('/maintenance/mr-1/complete'))
  assert.equal(vm.record.status, 'PENDING_CONFIRM')
  assert.equal(vm.record.resolution, '已更换水龙头')
})
