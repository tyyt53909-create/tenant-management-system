import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  centsToChineseUppercase,
  formatVoucherData,
  generateVoucherText,
} from '../utils/voucher.js'

let clipboardData = null
let phoneCalls = []
let toasts = []

beforeEach(() => {
  clipboardData = null
  phoneCalls = []
  toasts = []
  globalThis.uni = {
    getStorageSync: () => 'mock-token',
    setClipboardData: ({ data, success }) => {
      clipboardData = data
      if (typeof success === 'function') success()
    },
    makePhoneCall: ({ phoneNumber }) => {
      phoneCalls.push(phoneNumber)
    },
    showToast: ({ title, icon }) => {
      toasts.push({ title, icon })
    },
    showLoading: () => {},
    hideLoading: () => {},
    switchTab: () => {},
  }
})

async function loadPage(path) {
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

test('centsToChineseUppercase 正确转换分至人民币大写金额', () => {
  assert.equal(centsToChineseUppercase(0), '零元整')
  assert.equal(centsToChineseUppercase(null), '零元整')
  assert.equal(centsToChineseUppercase(-10), '零元整')
  assert.equal(centsToChineseUppercase(250000), '貳仟伍佰元整')
  assert.equal(centsToChineseUppercase(10050), '壹佰元伍角')
  assert.equal(centsToChineseUppercase(10005), '壹佰元零伍分')
  assert.equal(centsToChineseUppercase(50), '伍角')
  assert.equal(centsToChineseUppercase(8), '捌分')
  assert.equal(centsToChineseUppercase(1000000), '壹萬元整')
  assert.equal(centsToChineseUppercase(1020000), '壹萬零貳佰元整')
})

test('formatVoucherData 结构化单据关键字段与核销标识', () => {
  const mockBill = {
    id: 'bill-123456',
    billNumber: 'BILL-202610-001',
    billType: 'RENT',
    period: '2026-10',
    amount: 250000,
    paidAmount: 50000,
    status: 'PARTIAL',
    dueDate: '2026-10-25T00:00:00.000Z',
    contract: {
      room: {
        roomNumber: '302',
        building: { name: '2号楼' },
      },
      tenant: { name: '张三' },
    },
  }

  const mockLandlord = {
    name: '李房东',
    phone: '13900001111',
    wechat: 'landlord_lee',
  }

  const data = formatVoucherData(mockBill, mockLandlord)

  assert.equal(data.billNumber, 'BILL-202610-001')
  assert.equal(data.fullRoomTitle, '2号楼 · 302室')
  assert.equal(data.tenantName, '张三')
  assert.equal(data.period, '2026-10')
  assert.equal(data.typeLabel, '房屋租金')
  assert.equal(data.billAmountYuan, '2500.00')
  assert.equal(data.paidAmountYuan, '500.00')
  assert.equal(data.unpaidAmountYuan, '2000.00')
  assert.equal(data.amountToPayCents, 200000)
  assert.equal(data.amountToPayYuan, '2000.00')
  assert.equal(data.chineseUppercase, '貳仟元整')
  assert.equal(data.dueDate, '2026-10-25')
  assert.equal(data.statusLabel, '部分缴纳')
  assert.equal(data.landlordName, '李房东')
  assert.equal(data.landlordWechat, 'landlord_lee')
  assert.equal(data.verifyCode, '[VOUCHER:BILL-202610-001:200000]')
})

test('已缴清账单的待缴金额为 0，不再回退成账单原额', () => {
  const data = formatVoucherData({
    id: 'bill-paid',
    billNumber: 'BILL-202610-009',
    billType: 'RENT',
    period: '2026-10',
    amount: 250000,
    paidAmount: 250000,
    status: 'PAID',
    dueDate: '2026-10-25T00:00:00.000Z',
    contract: {
      room: { roomNumber: '302', building: { name: '2号楼' } },
      tenant: { name: '张三' },
    },
  }, { name: '李房东', wechat: 'landlord_lee' })

  assert.equal(data.amountToPayCents, 0)
  assert.equal(data.amountToPayYuan, '0.00')
  assert.equal(data.chineseUppercase, '零元整')
  assert.equal(data.verifyCode, '[VOUCHER:BILL-202610-009:0]')
})

test('generateVoucherText 生成包含防伪单据码的复制文本', () => {
  const voucherData = {
    billNumber: 'B-8820',
    fullRoomTitle: '1号楼 · 101室',
    tenantName: '李四',
    period: '2026-10',
    typeLabel: '水电费用',
    amountToPayYuan: '150.00',
    chineseUppercase: '壹佰伍拾元整',
    dueDate: '2026-10-20',
    landlordWechat: 'qiju_service',
    verifyCode: '[VOUCHER:B-8820:15000]',
  }

  const text = generateVoucherText(voucherData)

  assert.ok(text.includes('1号楼 · 101室'))
  assert.ok(text.includes('李四'))
  assert.ok(text.includes('¥ 150.00'))
  assert.ok(text.includes('壹佰伍拾元整'))
  assert.ok(text.includes('B-8820'))
  assert.ok(text.includes('qiju_service'))
  assert.ok(text.includes('[VOUCHER:B-8820:15000]'))
})

test('bill-detail 页面加载账单后自动构建单据数据并支持一键复制单据摘要与房东微信', async () => {
  const vm = await loadPage('bill-detail/bill-detail')
  vm.bill = {
    id: 'b-999',
    billNumber: 'BILL-999',
    billType: 'RENT',
    period: '2026-11',
    amount: 180000,
    paidAmount: 0,
    status: 'PENDING',
    dueDate: '2026-11-05',
    contract: {
      room: {
        roomNumber: '501',
        building: {
          name: '锦绣楼',
          metadata: {
            landlordName: '王管家',
            landlordWechat: 'wang_manage',
            landlordPhone: '13812345678',
          },
        },
      },
      tenant: { name: '赵六' },
    },
  }

  assert.equal(vm.voucherData.fullRoomTitle, '锦绣楼 · 501室')
  assert.equal(vm.voucherData.amountToPayYuan, '1800.00')
  assert.equal(vm.voucherData.chineseUppercase, '壹仟捌佰元整')

  vm.handleCopyText()
  assert.ok(clipboardData.includes('BILL-999'))
  assert.ok(clipboardData.includes('[VOUCHER:BILL-999:180000]'))
  assert.ok(toasts.some((t) => t.title.includes('复制')))

  vm.copyWechat()
  assert.equal(clipboardData, 'wang_manage')

  vm.callLandlord()
  assert.equal(phoneCalls[0], '13812345678')
})
