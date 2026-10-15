import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { hasCapability } from '../utils/session.js'

async function page(path) {
  const url = new URL(`../pages/${path}.vue`, import.meta.url)
  const source = await readFile(url, 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import (\w+) from '[^']+\.vue'/g, (_, name) => `const ${name} = {}`)
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, url).href}'`)
  const options = (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
  const vm = options.data()
  for (const [key, method] of Object.entries(options.methods || {})) vm[key] = method.bind(vm)
  for (const [key, getter] of Object.entries(options.computed || {})) Object.defineProperty(vm, key, { get: () => getter.call(vm) })
  return vm
}

let storage, calls, replies, navigation, toasts

beforeEach(() => {
  storage = new Map()
  calls = []
  replies = []
  navigation = []
  toasts = []
  globalThis.uni = {
    getStorageSync: (key) => storage.get(key) || (key === 'access_token' ? 'test-token' : ''),
    setStorageSync: (key, val) => storage.set(key, val),
    removeStorageSync: (key) => storage.delete(key),
    navigateTo: ({ url }) => navigation.push(url),
    switchTab: ({ url }) => navigation.push(url),
    reLaunch: ({ url }) => navigation.push(url),
    showToast: ({ title }) => toasts.push(title),
    showLoading: () => {},
    hideLoading: () => {},
    pageScrollTo: () => {},
    request: (options) => {
      calls.push(options)
      const data = replies.shift()
      assert.ok(data, `Unexpected request ${options.url}`)
      if (data.status && data.status >= 400) {
        options.success({ statusCode: data.status, data: { message: data.message || 'CAPABILITY_DENIED' } })
      } else {
        options.success({ statusCode: 200, data })
      }
    },
  }
})

test('hasCapability: 没有缓存时不视为全部允许', () => {
  assert.equal(hasCapability('tenant.bill.read'), false)
  assert.equal(hasCapability('tenant.maintenance.create'), false)
})

test('hasCapability: 根据缓存的能力集合正确判定', () => {
  storage.set('user_capabilities', ['tenant.contract.read', 'tenant.bill.read'])
  assert.equal(hasCapability('tenant.contract.read'), true)
  assert.equal(hasCapability('tenant.bill.read'), true)
  assert.equal(hasCapability('tenant.maintenance.create'), false)
  assert.equal(hasCapability('tenant.prepay.read'), false)

  // 空数组表示所有均被屏蔽
  storage.set('user_capabilities', [])
  assert.equal(hasCapability('tenant.bill.read'), false)
})

test('账单页面: 当 tenant.bill.read 屏蔽时不发起请求并展示暂停提示', async () => {
  storage.set('user_capabilities', ['tenant.maintenance.read'])
  const vm = await page('bills/bills')
  replies.push({ role: 'TENANT', capabilities: ['tenant.maintenance.read'] })
  await vm.loadBills()
  assert.equal(vm.blocked, true)
  // 只调用了 ensureTenantSession 中的 /auth/me，未调用 /bills/my
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/auth/me'))
})

test('账单页面: 服务端返回 CAPABILITY_DENIED 优雅降级并展示暂停提示', async () => {
  storage.set('user_capabilities', ['tenant.bill.read'])
  const vm = await page('bills/bills')
  replies.push(
    { role: 'TENANT', capabilities: ['tenant.bill.read'] },
    { status: 403, message: 'CAPABILITY_DENIED' },
  )
  await vm.loadBills()
  assert.equal(vm.blocked, true)
  assert.equal(vm.error, '')
})

test('报修页面: tenant.maintenance.read 屏蔽时不拉取记录并展示暂停提示', async () => {
  storage.set('user_capabilities', ['tenant.bill.read'])
  const vm = await page('maintenance/maintenance')
  replies.push({ role: 'TENANT', capabilities: ['tenant.bill.read'] })
  await vm.loadMaintenanceList()
  assert.equal(vm.readBlocked, true)
  assert.equal(calls.length, 1)
})

test('报修页面: tenant.maintenance.create 屏蔽时隐藏发起按钮并拦截提交', async () => {
  storage.set('user_capabilities', ['tenant.maintenance.read'])
  const vm = await page('maintenance/maintenance')
  assert.equal(vm.canCreateMaintenance, false)
  vm.form = { title: '漏水', description: '严重漏水', category: 'PLUMBING', priority: 'NORMAL', images: [] }
  await vm.submitMaintenance()
  assert.equal(calls.length, 0)
  assert.ok(toasts.some(t => t.includes('暂停')))
})

test('个人中心与首页: 依 capabilities 过滤合同与账户入口，加载失败时不当全部允许', async () => {
  const profileVm = await page('profile/profile')
  profileVm.capabilities = ['tenant.contract.read']
  assert.ok(profileVm.visibleMenu.some(m => m.label === '我的合同'))
  assert.ok(!profileVm.visibleMenu.some(m => m.label === '账户余额'))

  // 模拟 /auth/me 失败时 capabilities 置为 null
  profileVm.capabilities = null
  assert.ok(!profileVm.visibleMenu.some(m => m.label === '我的合同'))
  assert.ok(!profileVm.visibleMenu.some(m => m.label === '账户余额'))
  assert.ok(profileVm.visibleMenu.some(m => m.label === '通知提醒'))

  replies.push({ status: 500, message: '暂不可用' })
  await profileVm.loadUserInfo()
  assert.equal(profileVm.capabilities, null)
  assert.match(profileVm.error, /未能加载/)
  assert.ok(!profileVm.visibleMenu.some(m => m.label === '我的合同'))
  assert.ok(!profileVm.visibleMenu.some(m => m.label === '账户余额'))
  assert.ok(profileVm.visibleMenu.some(m => m.label === '通知提醒'))
})
