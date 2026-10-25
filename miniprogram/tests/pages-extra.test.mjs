import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolvePageUrl } from './_page-loader.mjs'

/**
 * FE-02 / T287：补齐此前没有单测的分包页面。
 *
 * 这些页面只依赖 Options API 的 data/methods，用同一套 uni mock 即可覆盖
 * 「筛选、分页、错误兜底、守卫」等真实分支，不需要跑渲染。
 */
async function loadPage(path) {
  const url = await resolvePageUrl(path)
  const source = await readFile(url, 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import (\w+) from '[^']+\.vue'/g, (_, name) => `const ${name} = {}`)
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, url).href}'`)
  const options = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const vm = options.data ? options.data() : {}
  // 合并 mixin（主题页的 `theme` 计算属性来自 themeMixin）
  const mixins = options.mixins || []
  const computed = Object.assign({}, ...mixins.map((m) => m.computed || {}), options.computed || {})
  const methods = Object.assign({}, ...mixins.map((m) => m.methods || {}), options.methods || {})
  for (const [key, method] of Object.entries(methods)) vm[key] = method.bind(vm)
  for (const [key, getter] of Object.entries(computed)) {
    Object.defineProperty(vm, key, { get: () => getter.call(vm) })
  }
  return vm
}

let calls, replies, navigation, toasts, modals
/** 按 URL 结尾匹配的响应，避免依赖并发请求的先后顺序 */
let routes

beforeEach(() => {
  calls = []
  replies = []
  navigation = []
  toasts = []
  modals = []
  routes = []
  globalThis.uni = {
    getStorageSync: (key) => (key === 'access_token' ? 'test-token' : key === 'user_role' ? 'TENANT' : ''),
    setStorageSync: () => {},
    removeStorageSync: () => {},
    navigateTo: ({ url }) => navigation.push(url),
    switchTab: ({ url }) => navigation.push(url),
    reLaunch: ({ url }) => navigation.push(url),
    showToast: (options) => toasts.push(options.title),
    showModal: (options) => {
      modals.push(options)
      options.success?.({ confirm: true })
    },
    request: (options) => {
      calls.push(options)
      const route = routes.find((item) => options.url.endsWith(item.url))
      const reply = route ? route.reply : replies.shift()
      assert.ok(reply, `Unexpected request ${options.url}`)
      const payload = typeof reply === 'function' ? reply() : reply
      if (payload.fail) options.fail(new Error('offline'))
      else options.success({ statusCode: payload.status || 200, data: payload.data })
    },
  }
})

test('通知页：按未读筛选时只传 unreadOnly，分页累加且标记已读后从未读列表移除', async () => {
  const vm = await loadPage('notifications/notifications')
  routes.push(
    { url: '/auth/me', reply: { data: { id: 'u1', role: 'TENANT', capabilities: [] } } },
    { url: '/notifications/unread-count', reply: { data: { unreadCount: 1 } } },
    { url: '/notifications', reply: { data: { data: [{ id: 'n1', isRead: false }], meta: { total: 2 } } } },
  )
  vm.filter = 'unread'
  await vm.refresh()

  const listCall = calls.find((call) => call.url.endsWith('/notifications'))
  assert.equal(listCall.data.unreadOnly, true)
  assert.equal(vm.list.length, 1)
  assert.equal(vm.unreadCount, 1)

  replies.push({ data: { ok: true } })
  await vm.handleRead(vm.list[0])
  assert.equal(vm.list.length, 0)
  assert.equal(vm.unreadCount, 0)
})

test('通知页：全部已读后清空未读角标并提示', async () => {
  const vm = await loadPage('notifications/notifications')
  vm.list = [{ id: 'n1', isRead: false }, { id: 'n2', isRead: false }]
  vm.unreadCount = 2
  replies.push({ data: { count: 2 } })
  await vm.handleReadAll()
  assert.equal(vm.unreadCount, 0)
  assert.ok(vm.list.every((item) => item.isRead))
  assert.deepEqual(toasts, ['已全部标记为已读'])
})

test('账户页：余额与流水组装为分单位文案，未知类型原样返回', async () => {
  const vm = await loadPage('account/account')
  assert.equal(vm.getTransactionTypeText('RECHARGE'), '充值')
  assert.equal(vm.getTransactionTypeText('UNKNOWN'), 'UNKNOWN')
  assert.equal(vm.formatDate('2026-10-25T09:30:00.000Z'), '2026-10-25 09:30')
  assert.equal(vm.formatDate(''), '')
})

test('合同页：无合同时给出空态文案，不抛错', async () => {
  const vm = await loadPage('contract/contract')
  assert.equal(typeof vm.loadContract, 'function')
  replies.push({ data: { id: 'u1', role: 'TENANT', capabilities: ['tenant.contract.read'] } })
  replies.push({ data: { data: [] } })
  await vm.loadContract()
  assert.deepEqual(vm.contracts ?? vm.list ?? [], [])
})

test('主题页：预览样式来自当前主题令牌', async () => {
  const vm = await loadPage('theme/theme')
  const style = vm.previewCardStyle
  assert.ok(style.backgroundColor)
  assert.ok(String(style.borderRadius).includes('rpx'))
  assert.ok(String(vm.previewTitleStyle.fontSize).includes('rpx'))
})
