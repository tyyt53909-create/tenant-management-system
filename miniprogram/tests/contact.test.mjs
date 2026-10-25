import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getLandlordContact, formatPhoneNumber, copyToClipboard, makePhoneCall } from '../utils/contact.js'
import { resolvePageUrl } from './_page-loader.mjs'

let calls, replies, navigation, toasts, clipboardData, phoneCalls

beforeEach(() => {
  calls = []
  replies = []
  navigation = []
  toasts = []
  clipboardData = null
  phoneCalls = []
  globalThis.uni = {
    getStorageSync: () => 'test-token',
    setStorageSync: () => {},
    navigateTo: ({ url }) => navigation.push(url),
    switchTab: ({ url }) => navigation.push(url),
    reLaunch: ({ url }) => navigation.push(url),
    showToast: ({ title, icon }) => toasts.push({ title, icon }),
    pageScrollTo: () => {},
    setClipboardData: ({ data, success }) => {
      clipboardData = data
      if (typeof success === 'function') success()
    },
    makePhoneCall: ({ phoneNumber }) => {
      phoneCalls.push(phoneNumber)
    },
    request: (options) => {
      calls.push(options)
      const data = replies.shift()
      assert.ok(data, `Unexpected request ${options.url}`)
      options.success({ statusCode: 200, data })
    },
  }
})

async function loadPage(path) {
  const url = await resolvePageUrl(path)
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

test('formatPhoneNumber 正确格式化 11 位手机号', () => {
  assert.equal(formatPhoneNumber('13800138000'), '138-0013-8000')
  assert.equal(formatPhoneNumber('02112345678'), '021-1234-5678')
  assert.equal(formatPhoneNumber('4001234567'), '4001234567')
  assert.equal(formatPhoneNumber(''), '')
})

test('getLandlordContact 从有效合同元数据中提取房东与管家信息', () => {
  const mockContracts = [
    {
      id: 'c-1',
      status: 'ACTIVE',
      room: {
        roomNumber: '302',
        building: {
          name: '望京A座',
          metadata: {
            landlordName: '张房东',
            landlordPhone: '13911112222',
            landlordWechat: 'zhang_landlord',
            serviceHours: '08:30 - 22:00',
            notice: '有事随时微信联系'
          }
        }
      }
    }
  ]

  const contact = getLandlordContact({}, mockContracts)
  assert.equal(contact.name, '张房东')
  assert.equal(contact.phone, '13911112222')
  assert.equal(contact.formattedPhone, '139-1111-2222')
  assert.equal(contact.wechat, 'zhang_landlord')
  assert.equal(contact.serviceHours, '08:30 - 22:00')
  assert.equal(contact.notice, '有事随时微信联系')
  assert.equal(contact.roomTitle, '望京A座 · 302室')
})

test('getLandlordContact 在元数据或合同缺失时提供优雅默认值', () => {
  const contact = getLandlordContact({}, [])
  assert.equal(contact.name, '栖居专属管家')
  assert.equal(contact.phone, '13800138000')
  assert.equal(contact.wechat, 'qiju_service')
  assert.equal(contact.serviceHours, '09:00 - 21:00')
  assert.ok(contact.notice.includes('紧急设施问题'))
})

test('copyToClipboard 复制微信号并弹出成功提示', () => {
  copyToClipboard('qiju_service', '微信号')
  assert.equal(clipboardData, 'qiju_service')
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].title, '微信号已复制')
})

test('makePhoneCall 清洗并调起系统拨打电话', () => {
  makePhoneCall('138-0013-8000')
  assert.deepEqual(phoneCalls, ['13800138000'])
})

test('profile 页面加载个人信息后成功设置管家联系信息且点击可复制微信', async () => {
  const vm = await loadPage('profile/profile')
  replies.push(
    {
      role: 'TENANT',
      email: 'tenant@test.com',
      tenant: {
        id: 't-1',
        name: '小王',
        contracts: [
          {
            status: 'ACTIVE',
            room: {
              roomNumber: '501',
              building: {
                name: '紫金公寓',
                metadata: {
                  landlordName: '李管家',
                  landlordPhone: '13700001111',
                  landlordWechat: 'lijing_mgr'
                }
              }
            }
          }
        ]
      }
    },
    { unreadCount: 2 }
  )

  await vm.loadUserInfo()
  assert.equal(vm.landlordContact.name, '李管家')
  assert.equal(vm.landlordContact.wechat, 'lijing_mgr')
  assert.equal(vm.landlordContact.phone, '13700001111')

  // 测试复制微信号
  vm.copyWechat()
  assert.equal(clipboardData, 'lijing_mgr')
  assert.equal(toasts[0].title, '微信号已复制')

  // 测试拨打电话
  vm.callLandlord()
  assert.deepEqual(phoneCalls, ['13700001111'])

  // 测试点击联系管理者打开弹窗
  assert.equal(vm.showContactModal, false)
  vm.showContact()
  assert.equal(vm.showContactModal, true)
})
