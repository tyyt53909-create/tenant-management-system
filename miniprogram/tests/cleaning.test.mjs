import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import request from '../utils/request.js'
import { startCleaning, completeCleaning } from '../api/index.js'
import { ensureTenantSession, openHome, clearSession } from '../utils/session.js'

// 测试实际 Options API 脚本，使用 uni mock，不复制业务逻辑。
async function loadPage(path) {
  const url = new URL(path, import.meta.url)
  const source = await readFile(url, 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    // 业务脚本测试只替换展示组件；组件模板由 H5/微信构建校验。
    .replace(/import (\w+) from '[^']+\.vue'/g, (_, name) => `const ${name} = {}`)
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, url).href}'`)
  return (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
}
const cleaningPage = await loadPage('../pages/cleaning/cleaning.vue')
const cleaningHome = await loadPage('../pages/cleaning/home.vue')
const cleaningSettings = await loadPage('../pages/cleaning/settings.vue')
const loginPage = await loadPage('../pages/login/login.vue')
function instance(page) {
  const vm = page.data()
  for (const [key, method] of Object.entries(page.methods)) vm[key] = method.bind(vm)
  for (const [key, getter] of Object.entries(page.computed || {})) Object.defineProperty(vm, key, { get: () => getter.call(vm) })
  return vm
}

let storage, calls, navigation, replies, modalConfirm, toasts
beforeEach(() => {
  storage = new Map([['access_token', 'unit-test-token']])
  calls = []; navigation = []; replies = []; toasts = []; modalConfirm = true
  globalThis.uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    reLaunch: options => navigation.push(options.url),
    switchTab: options => navigation.push(options.url),
    navigateTo: options => navigation.push(options.url),
    showToast: options => toasts.push(options.title),
    showModal: options => options.success({ confirm: modalConfirm }),
    pageScrollTo: () => {},
    request: options => {
      calls.push(options)
      const reply = replies.shift()
      assert.ok(reply, `Unexpected request: ${options.url}`)
      if (reply.fail) options.fail(new Error('offline'))
      else options.success({ statusCode: reply.status || 200, data: reply.data })
    }
  }
})
const room = { id: 'room-1', roomNumber: '101', floor: 1, building: { name: 'A栋' },
  status: 'VACANT', cleanStatus: 'PENDING_CLEAN', version: 3 }
const list = (data = [room], page = 1, totalPages = 1) => ({ data,
  meta: { page, totalPages, total: data.length } })
const ready = (status = 'PENDING_CLEAN') => {
  const vm = instance(cleaningPage)
  vm.authorized = true
  vm.rooms = [{ ...room, cleanStatus: status }]
  return vm
}

test('request supports PATCH, 201 and 204 without losing authorization', async () => {
  replies.push({ status: 201, data: { ok: true } }, { status: 204 })
  assert.deepEqual(await request.post('/test', {}), { ok: true })
  await request.patch('/test', {})
  assert.equal(calls[1].method, 'PATCH')
  assert.equal(calls[1].header.Authorization, 'Bearer unit-test-token')
})
test('API mutations send optimistic version and encode room ID', async () => {
  replies.push({ data: {} }, { data: {} })
  await startCleaning('a/b', 4)
  await completeCleaning('a/b', 5)
  assert.ok(calls[0].url.endsWith('/rooms/a%2Fb/status'))
  assert.deepEqual(calls[0].data, { cleanStatus: 'CLEANING', version: 4 })
  assert.deepEqual(calls[1].data, { version: 5 })
})
test('HTTP conflict preserves status and validation messages', async () => {
  replies.push({ status: 409, data: { message: ['状态冲突', '请刷新'] } })
  await assert.rejects(request.patch('/test'), error => error.statusCode === 409 && error.message === '状态冲突；请刷新')
})
test('401 clears all session keys and redirects to login', async () => {
  storage.set('refresh_token', 'refresh'); storage.set('user_role', 'CLEANER')
  replies.push({ status: 401, data: {} }, { status: 401, data: {} })
  await assert.rejects(request.get('/test'))
  assert.equal(storage.size, 0)
  assert.deepEqual(navigation, ['/pages/login/login'])
})
test('network failure rejects', async () => {
  replies.push({ fail: true })
  await assert.rejects(request.get('/test'))
})
test('role routes separate cleaners and tenants', () => {
  openHome('CLEANER'); openHome('TENANT')
  assert.deepEqual(navigation, ['/pages/cleaning/home', '/pages/index/index'])
})
test('old cleaner session is identified before tenant API requests', async () => {
  replies.push({ data: { role: 'CLEANER' } })
  assert.equal(await ensureTenantSession(), false)
  assert.equal(storage.get('user_role'), 'CLEANER')
  assert.equal(calls.length, 1)
})
test('missing token does not request protected data', async () => {
  storage.clear()
  assert.equal(await ensureTenantSession(), false)
  await instance(cleaningPage).refresh()
  assert.equal(calls.length, 0)
})
test('tenant session remains allowed', async () => {
  replies.push({ data: { role: 'TENANT' } })
  assert.equal(await ensureTenantSession(), true)
  assert.equal(navigation.length, 0)
})
test('empty task list is successful, not an error', async () => {
  replies.push({ data: { role: 'CLEANER' } }, { data: list([]) })
  const vm = instance(cleaningPage)
  await vm.refresh()
  assert.equal(vm.authorized, true)
  assert.equal(vm.error, '')
  assert.equal(vm.total, 0)
  await vm.loadMore()
  assert.equal(calls.length, 2)
})
test('unauthorized page cannot submit mutations', async () => {
  const vm = instance(cleaningPage)
  await vm.handleAction(room)
  assert.equal(calls.length, 0)
})
test('cleaner list only retains safe room fields and cleanable rooms', async () => {
  replies.push({ data: { role: 'CLEANER' } }, { data: list([
    { ...room, tenant: { name: 'PRIVATE' }, contracts: [{}], description: 'PRIVATE' },
    { ...room, id: 'occupied', status: 'OCCUPIED' }
  ]) })
  const vm = instance(cleaningPage)
  await vm.refresh()
  assert.equal(vm.authorized, true)
  assert.equal(vm.rooms.length, 1)
  assert.deepEqual(Object.keys(vm.rooms[0]).sort(), ['id', 'roomNumber', 'floor', 'buildingName', 'cleanStatus', 'version'].sort())
  assert.ok(!JSON.stringify(vm.rooms).includes('PRIVATE'))
})
test('tenant cannot load cleaner tasks', async () => {
  replies.push({ data: { role: 'TENANT' } })
  const vm = instance(cleaningPage)
  await vm.refresh()
  assert.equal(vm.authorized, false)
  assert.equal(calls.length, 1)
  assert.deepEqual(navigation, ['/pages/index/index'])
})
test('list fetch failure shows retry state without stale data', async () => {
  replies.push({ data: { role: 'CLEANER' } }, { fail: true })
  const vm = ready()
  await vm.refresh()
  assert.equal(vm.loading, false)
  assert.equal(vm.rooms.length, 0)
  assert.ok(vm.error)
})
test('pagination fetches next page and only advances after success', async () => {
  const vm = ready(); vm.page = 1; vm.totalPages = 3
  replies.push({ data: list([{ ...room, id: 'room-2' }], 2, 3) })
  await vm.loadMore()
  assert.equal(vm.rooms.length, 2)
  assert.equal(vm.page, 2)
  replies.push({ fail: true })
  await vm.loadMore()
  assert.equal(vm.page, 2)
  assert.ok(vm.error)
})
test('start action sends version and reloads server state', async () => {
  const vm = ready()
  replies.push({ data: {} }, { data: list([{ ...room, cleanStatus: 'CLEANING', version: 4 }]) })
  await vm.handleAction(vm.rooms[0])
  assert.deepEqual(calls[0].data, { cleanStatus: 'CLEANING', version: 3 })
  assert.equal(vm.rooms[0].version, 4)
  assert.equal(vm.busyId, '')
})
test('completion requires confirmation and removes completed room after reload', async () => {
  const vm = ready('CLEANING')
  replies.push({ data: {} }, { data: list([]) })
  await vm.handleAction(vm.rooms[0])
  assert.ok(calls[0].url.endsWith('/clean'))
  assert.deepEqual(calls[0].data, { version: 3 })
  assert.equal(vm.rooms.length, 0)
})
test('cancelled completion performs no mutation', async () => {
  modalConfirm = false
  const vm = ready('CLEANING')
  await vm.handleAction(vm.rooms[0])
  assert.equal(calls.length, 0)
  assert.equal(vm.busyId, '')
})
test('concurrent tap is ignored while confirmation is pending', async () => {
  let finish
  uni.showModal = options => { finish = options.success }
  const vm = ready('CLEANING')
  const action = vm.handleAction(vm.rooms[0])
  await vm.handleAction(vm.rooms[0])
  assert.equal(calls.length, 0)
  finish({ confirm: false }); await action
  assert.equal(vm.busyId, '')
})
test('conflict reloads without automatically retrying mutation', async () => {
  replies.push({ status: 409, data: { message: 'version conflict' } },
    { data: list([{ ...room, cleanStatus: 'CLEANING', version: 8 }]) })
  const vm = ready()
  await vm.handleAction(vm.rooms[0])
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1)
  assert.equal(vm.rooms[0].version, 8)
  assert.ok(vm.error.includes('状态已变化'))
})
test('failed refresh after conflict removes stale actionable list', async () => {
  replies.push({ status: 409, data: {} }, { fail: true })
  const vm = ready()
  await vm.handleAction(vm.rooms[0])
  assert.equal(vm.rooms.length, 0)
  assert.ok(vm.error.includes('刷新失败'))
})
test('missing version cannot submit a cleaning mutation', async () => {
  const vm = ready(); delete vm.rooms[0].version
  await vm.handleAction(vm.rooms[0])
  assert.equal(calls.length, 0)
  assert.ok(vm.error.includes('版本'))
})
test('logout clears role and tokens and leaves work page', () => {
  storage.set('user_role', 'CLEANER'); storage.set('refresh_token', 'refresh')
  replies.push({ data: { message: '已登出' } })
  const vm = ready(); vm.logout()
  assert.equal(storage.size, 0)
  assert.equal(vm.authorized, false)
  assert.equal(calls.at(-1).data.refreshToken, 'refresh')
  assert.ok(String(calls.at(-1).url).endsWith('/auth/logout'))
  clearSession()
})
test('cleaner login goes directly to work page', async () => {
  const vm = instance(loginPage); vm.form = { account: 'cleaner@example.test', password: 'test-only' }
  replies.push({ data: { accessToken: 'token', refreshToken: 'refresh', user: { role: 'CLEANER' } } })
  await vm.handleLogin()
  assert.equal(storage.get('user_role'), 'CLEANER')
  assert.deepEqual(navigation, ['/pages/cleaning/home'])
})
test('tenant login preserves existing home tab', async () => {
  const vm = instance(loginPage); vm.form = { account: 'tenant@example.test', password: 'test-only' }
  replies.push({ data: { accessToken: 'token', refreshToken: 'refresh', user: { role: 'TENANT' } } })
  await vm.handleLogin()
  assert.deepEqual(navigation, ['/pages/index/index'])
})
for (const [path, method] of [
  ['index/index', 'loadData'], ['bills/bills', 'loadBills'],
  ['maintenance/maintenance', 'loadMaintenanceList'],
  ['account/account', 'loadData'], ['contract/contract', 'loadContract'],
  ['profile/profile', 'loadUserInfo']
]) {
  test(`cleaner entering ${path} never requests tenant business data`, async () => {
    const page = await loadPage(`../pages/${path}.vue`)
    replies.push({ data: { role: 'CLEANER' } })
    await instance(page)[method]()
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.endsWith('/auth/me'))
    assert.deepEqual(navigation, ['/pages/cleaning/home'])
  })
}

test('保洁首页汇总待清洁与清洁中，并可直达任务视图', async () => {
  replies.push(
    { data: { id: 'cleaner-1', email: 'cleaner@example.com', role: 'CLEANER' } },
    { data: list([room, { ...room, id: 'room-2', roomNumber: '205', cleanStatus: 'CLEANING' }]) },
    { data: { unreadCount: 1 } },
  )
  const vm = instance(cleaningHome)
  await vm.load()

  assert.deepEqual(vm.counts, { pending: 1, cleaning: 1 })
  assert.equal(vm.recent.length, 1)
  assert.equal(vm.unreadCount, 1)

  vm.goWork('cleaning')
  assert.deepEqual(navigation, ['/pages/cleaning/cleaning?view=cleaning'])
})

test('保洁设置页读取账号与未读，并可进入主题设置', async () => {
  replies.push(
    { data: { id: 'cleaner-1', email: 'cleaner@example.com', role: 'CLEANER' } },
    { data: { unreadCount: 3 } },
  )
  const vm = instance(cleaningSettings)
  await vm.load()

  assert.equal(vm.email, 'cleaner@example.com')
  assert.equal(vm.initial, 'C')
  assert.equal(vm.unreadCount, 3)

  vm.goTheme()
  assert.deepEqual(navigation, ['/pages/theme/theme'])
})

test('保洁工作台按待清洁/清洁中本地切换', () => {
  const vm = instance(cleaningPage)
  vm.authorized = true
  vm.rooms = [room, { ...room, id: 'room-2', cleanStatus: 'CLEANING' }]

  vm.view = 'pending'
  assert.equal(vm.visibleRooms.length, 1)
  assert.equal(vm.visibleRooms[0].cleanStatus, 'PENDING_CLEAN')

  vm.view = 'cleaning'
  assert.equal(vm.visibleRooms.length, 1)
  assert.equal(vm.visibleRooms[0].cleanStatus, 'CLEANING')

  vm.view = 'all'
  assert.equal(vm.visibleRooms.length, 2)
})
