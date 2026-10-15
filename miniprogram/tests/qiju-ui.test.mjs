import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
let calls, replies, navigation, toasts
beforeEach(() => {
  calls = []; replies = []; navigation = []; toasts = []
  globalThis.uni = {
    getStorageSync: (key) => (key === 'user_capabilities' ? ['tenant.bill.read', 'tenant.bills.read', 'tenant.bills.export', 'tenant.maintenance.create', 'tenant.maintenance.read', 'tenant.prepay.read', 'tenant.contract.read', 'tenant.meters.read', 'tenant.checkout.read'] : 'test-token'),
    setStorageSync: () => {},
    navigateTo: ({ url }) => navigation.push(url), switchTab: ({ url }) => navigation.push(url), reLaunch: ({ url }) => navigation.push(url),
    showToast: ({ title }) => toasts.push(title), pageScrollTo: () => {},
    request: (options) => { calls.push(options); const data = replies.shift(); assert.ok(data, `Unexpected request ${options.url}`); options.success({ statusCode: 200, data }) },
  }
})

test('账单卡片打开真实详情，不模拟付款', async () => {
  const vm = await page('bills/bills'); vm.viewDetail({ id: 'a/b' })
  assert.deepEqual(navigation, ['/pages/bill-detail/bill-detail?id=a%2Fb'])
  assert.equal(calls.length, 0)
})
test('报修类别需要选择，下一步保留真实枚举', async () => {
  const vm = await page('maintenance/maintenance')
  vm.nextStep(); assert.equal(vm.step, 1); assert.equal(toasts.length, 1)
  vm.chooseCategory(vm.categoryOptions[0]); vm.nextStep()
  assert.equal(vm.step, 2); assert.equal(vm.form.category, 'PLUMBING'); assert.equal(vm.form.priority, 'NORMAL')
})
test('重复点击提交不产生第二份工单', async () => {
  const vm = await page('maintenance/maintenance'); vm.submitting = true
  await vm.submitMaintenance(); assert.equal(calls.length, 0)
})
test('有效报修提交真实接口并显示服务端编号', async () => {
  const vm = await page('maintenance/maintenance')
  vm.form = { title: ' 厨房漏水 ', description: ' 水槽接口漏水 ', category: 'PLUMBING', priority: 'NORMAL', images: [] }
  replies.push({ role: 'TENANT' }, { id: 'server-request-id', status: 'SUBMITTED' })
  await vm.submitMaintenance()
  assert.equal(calls[1].method, 'POST'); assert.ok(calls[1].url.endsWith('/maintenance'))
  assert.deepEqual(calls[1].data, { title: '厨房漏水', description: '水槽接口漏水', category: 'PLUMBING', priority: 'NORMAL' })
  assert.equal(vm.submitted.id, 'server-request-id'); assert.equal(vm.currentTab, 'success'); assert.equal(vm.submitting, false)
})
test('保洁进入新增详情页时不请求租客数据', async () => {
  for (const path of ['bill-detail/bill-detail', 'maintenance/detail']) {
    const vm = await page(path); vm.id = 'record'; replies.push({ role: 'CLEANER' })
    await vm.load()
  }
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.url.endsWith('/auth/me')))
  assert.deepEqual(navigation, ['/pages/cleaning/cleaning', '/pages/cleaning/cleaning'])
})
test('首页仍是默认入口，详情页不混入原生四个 tab', async () => {
  const pages = JSON.parse(await readFile(new URL('../pages.json', import.meta.url), 'utf8'))
  assert.equal(pages.pages[0].path, 'pages/index/index')
  assert.equal(pages.tabBar.list.length, 4)
  assert.ok(pages.pages.some(p => p.path === 'pages/bill-detail/bill-detail'))
  assert.ok(pages.pages.some(p => p.path === 'pages/maintenance/detail'))
})
test('待缴费筛选包含逾期和部分缴纳，不遗漏欠款账单', async () => {
  const vm=await page('bills/bills');vm.currentTab='pending'
  replies.push({role:'TENANT'},...[{id:'p',status:'PENDING'},{id:'part',status:'PARTIAL'},{id:'over',status:'OVERDUE'}].map(row=>({data:[row],meta:{page:1,totalPages:1}})))
  await vm.loadBills()
  assert.deepEqual(calls.slice(1).map(call=>call.data.status),['PENDING','PARTIAL','OVERDUE'])
  assert.equal(vm.bills.length,3);assert.equal(vm.hasMore,false)
})
test('错误密码提示凭据错误而不是误报登录过期', async()=>{
  const {default:request}=await import('../utils/request.js');let cleared=false
  uni.removeStorageSync=()=>{cleared=true}
  uni.request=options=>options.success({statusCode:401,data:{message:'邮箱/手机号或密码错误'}})
  await assert.rejects(request.post('/auth/login',{}),/邮箱\/手机号或密码错误/)
  assert.equal(cleared,false);assert.equal(navigation.length,0)
})
test('账户未开通显示明确状态，不伪造零元余额',async()=>{
  const vm=await page('account/account')
  uni.request=options=>options.success(options.url.endsWith('/auth/me')?{statusCode:200,data:{role:'TENANT'}}:{statusCode:404,data:{message:'预付账户不存在'}})
  await vm.loadData()
  assert.equal(vm.noAccount,true);assert.equal(vm.loaded,false);assert.equal(vm.error,'');assert.equal(vm.loading,false)
})
test('我的合同加载扫描图片并使用合同归属下载地址',async()=>{
  const vm=await page('contract/contract')
  replies.push({role:'TENANT'},{data:[{id:'c1',status:'ACTIVE'}]},[{id:'a1',downloadUrl:'/api/contracts/c1/attachments/a1/file',fileName:'scan.png'}])
  await vm.loadContract()
  assert.ok(calls[2].url.endsWith('/contracts/c1/attachments'))
  assert.equal(vm.attachments[0].downloadUrl,'/api/contracts/c1/attachments/a1/file')
  assert.equal(vm.attachmentsLoading,false);assert.equal(vm.attachmentsError,'')
})
test('合同图片失败不伪装成尚未上传，重试可恢复',async()=>{
  const vm=await page('contract/contract');vm.contract={id:'c1'}
  uni.request=options=>options.fail(new Error('offline'))
  await vm.loadAttachments()
  assert.equal(vm.attachmentsError,'合同图片未能加载');assert.equal(vm.attachmentsLoading,false)
  replies.push([{id:'a1'}]);uni.request=options=>options.success({statusCode:200,data:replies.shift()})
  await vm.loadAttachments()
  assert.equal(vm.attachmentsError,'');assert.equal(vm.attachments.length,1)
})
test('合同图片旧请求不能覆盖新请求',async()=>{
  const vm=await page('contract/contract');vm.contract={id:'c1'};const pending=[]
  uni.request=options=>pending.push(options)
  const old=vm.loadAttachments();const fresh=vm.loadAttachments()
  pending[1].success({statusCode:200,data:[{id:'new'}]});await fresh
  pending[0].success({statusCode:200,data:[{id:'old'}]});await old
  assert.equal(vm.attachments[0].id,'new');assert.equal(vm.attachmentsLoading,false)
})
test('保洁不能进入合同附件接口',async()=>{
  const vm=await page('contract/contract');replies.push({role:'CLEANER'})
  await vm.loadContract()
  assert.equal(calls.length,1);assert.equal(vm.contract,null)
  assert.deepEqual(navigation,['/pages/cleaning/cleaning'])
})
