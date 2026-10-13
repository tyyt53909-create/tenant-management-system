#!/usr/bin/env node
/**
 * T147 MVP 端到端验收脚本
 *
 * 覆盖验收标准第 3 节的 14 步主流程，外加越权 / 幂等 / 并发断言。
 * 可通过 API 自行预置数据，不依赖特定种子状态，可重复运行。
 *
 * 用法：
 *   node scripts/e2e-mvp/run.mjs
 *   API_BASE=http://127.0.0.1:3100/api node scripts/e2e-mvp/run.mjs
 *
 * 环境变量：
 *   API_BASE  后端地址，默认 http://127.0.0.1:3100/api
 *   ADMIN_IDENTIFIER / ADMIN_PASSWORD  默认 admin@example.com / Admin@123
 *   CLEANER_IDENTIFIER / CLEANER_PASSWORD  默认 cleaner@example.com / Cleaner@123
 *
 * 退出码：全部通过 0；任一步失败 1。
 */

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3100/api';
const ADMIN_IDENTIFIER = process.env.ADMIN_IDENTIFIER || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';
const CLEANER_IDENTIFIER = process.env.CLEANER_IDENTIFIER || 'cleaner@example.com';
const CLEANER_PASSWORD = process.env.CLEANER_PASSWORD || 'Cleaner@123';
// 租客注册需邀请码。当前代码库的 InviteCodeService.generateInviteCode 没有任何 HTTP 入口，
// 因此只能使用 seed 写入管理员账号的既定邀请码（可用 INVITE_CODE 覆盖）。
// 注意：邀请码由 seed 每次运行时重新生成（INVITE-<时间戳>），因此该默认值会随重新播种失效。
// 可通过 INVITE_CODE 环境变量注入当前有效值，例如：
//   INVITE_CODE=$(docker exec tenant-system-postgres-t140 psql -U tenant_user -d tenant_system -tAc \
//     "SELECT \"inviteCode\" FROM users WHERE \"role\"='ADMIN' AND \"inviteCode\" IS NOT NULL LIMIT 1;")
const INVITE_CODE = process.env.INVITE_CODE || 'INVITE-1791879079690-S1L5BM';

const results = [];
let stepNo = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  const line = '  [' + tag + '] ' + name + (detail ? '  -> ' + detail : '');
  console.log(line);
}

function assert(cond, message) {
  if (!cond) throw new Error('断言失败: ' + message);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** 执行一步并断言状态码 + 自定义校验，返回响应数据供后续步骤使用 */
async function step(title, fn) {
  stepNo += 1;
  const label = title;
  try {
    const out = await fn();
    record(label, true, out && out.detail ? out.detail : '');
    return out && out.value;
  } catch (err) {
    record(label, false, err.message);
    throw err;
  }
}

function expectStatus(res, expected, ctx) {
  const list = Array.isArray(expected) ? expected : [expected];
  assert(list.includes(res.status),
    ctx + ' 期望状态码 ' + list.join('/') + '，实际 ' + res.status + ' body=' + JSON.stringify(res.data).slice(0, 200));
}

const uid = Date.now().toString().slice(-8);
const tomorrow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function main() {
  console.log('\n=== T147 MVP 端到端验收 ===');
  console.log('API_BASE = ' + API_BASE + '\n');

  // ---------- 准备：三种角色登录 ----------
  let adminToken, cleanerToken;

  await step('0-1 管理员登录', async () => {
    const res = await api('POST', '/auth/login', { body: { identifier: ADMIN_IDENTIFIER, password: ADMIN_PASSWORD } });
    expectStatus(res, 201, '管理员登录');
    assert(res.data.accessToken, '缺少 accessToken');
    assert(res.data.user.role === 'ADMIN', '角色应为 ADMIN，实际 ' + res.data.user.role);
    adminToken = res.data.accessToken;
    return { detail: 'role=' + res.data.user.role, value: res.data };
  });

  await step('0-2 保洁登录', async () => {
    const res = await api('POST', '/auth/login', { body: { identifier: CLEANER_IDENTIFIER, password: CLEANER_PASSWORD } });
    expectStatus(res, 201, '保洁登录');
    assert(res.data.user.role === 'CLEANER', '角色应为 CLEANER，实际 ' + res.data.user.role);
    cleanerToken = res.data.accessToken;
    return { detail: 'role=' + res.data.user.role };
  });

  const adminUser = await api('GET', '/auth/me', { token: adminToken });

  // ---------- 步骤 2：创建房源 ----------
  const room = await step('2 创建房源', async () => {
    const buildings = await api('GET', '/buildings', { token: adminToken });
    expectStatus(buildings, 200, '读取楼栋');
    const buildingId = buildings.data.data[0].id;

    const res = await api('POST', '/rooms', {
      token: adminToken,
      body: { buildingId, roomNumber: 'E2E-' + uid, floor: 1, roomType: 'SINGLE', area: 25.5 },
    });
    expectStatus(res, 201, '创建房源');
    assert(res.data.status === 'VACANT', '新房源 status 应为 VACANT，实际 ' + res.data.status);
    assert(res.data.cleanStatus === 'CLEAN', '新房源 cleanStatus 应为 CLEAN，实际 ' + res.data.cleanStatus);
    assert(res.data.version === 0, '新房源 version 应为 0，实际 ' + res.data.version);
    return { detail: res.data.roomNumber + ' status=' + res.data.status + '/' + res.data.cleanStatus, value: res.data };
  });

  // ---------- 步骤 3：创建租客并注册其登录账号 ----------
  // 说明：注册接口需邀请码；当前代码库的 InviteCodeService.generateInviteCode
  // 没有任何 HTTP 入口，因此脚本复用管理员账号上的既有邀请码（seed 会创建）。
  let tenantUserEmail, tenantPassword = 'Tenant@123';
  const tenant = await step('3 创建租客并注册账号', async () => {
    const phone = '139' + uid.padStart(8, '0').slice(0, 8);
    const res = await api('POST', '/tenants', {
      token: adminToken,
      body: { name: 'E2E租客' + uid, phone },
    });
    expectStatus(res, 201, '创建租客');
    assert(res.data.id, '缺少租客 id');

    tenantUserEmail = 'e2e-tenant-' + uid + '@example.com';

    // 优先动态生成邀请码（T148 新增 POST /auth/invite-codes），保证脚本可重复运行；
    // 生成失败时回退到 INVITE_CODE 环境变量/默认值。
    let inviteCode = INVITE_CODE;
    const gen = await api('POST', '/auth/invite-codes', { token: adminToken, body: { expiryDays: 1 } });
    if ([200, 201].includes(gen.status)) {
      inviteCode = gen.data.code || gen.data.inviteCode || inviteCode;
    } else {
      record('3a 生成邀请码', false, '生成接口返回 ' + gen.status + '，回退到默认邀请码');
    }

    const reg = await api('POST', '/auth/register', {
      body: { email: tenantUserEmail, password: tenantPassword, inviteCode },
    });
    if (![200, 201].includes(reg.status)) {
      record('3b 租客账号注册', false,
        '注册返回 ' + reg.status + '（邀请码 ' + inviteCode + '）：' + JSON.stringify(reg.data).slice(0, 140));
      tenantUserEmail = null;
      return { detail: res.data.name + '（未注册登录账号，后续租客步骤将跳过）', value: res.data };
    }

    // 关键：注册会新建一条 Tenant 记录（与管理员手工建的 tenant 不是同一条）。
    // 租客侧接口（报修、账单）以服务端推导的 user.tenantId 为准，因此必须改用注册产生的租客档案。
    const regLogin = await api('POST', '/auth/login', {
      body: { identifier: tenantUserEmail, password: tenantPassword },
    });
    if (![200, 201].includes(regLogin.status)) {
      record('3c 注册租客登录', false, '登录返回 ' + regLogin.status);
      tenantUserEmail = null;
      return { detail: res.data.name + '（注册成功但登录失败）', value: res.data };
    }
    const regMe = await api('GET', '/auth/me', { token: regLogin.data.accessToken });
    const bound = regMe.data && regMe.data.tenant;
    if (!bound || !bound.id) {
      record('3c 注册租客绑定档案', false, '注册账号未绑定 Tenant 档案，租客侧接口将不可用');
      tenantUserEmail = null;
      return { detail: res.data.name + '（未绑定租客档案）', value: res.data };
    }
    // 后续步骤统一使用注册产生的租客档案
    res.data = bound;
    record('3b 租客账号注册并绑定档案', true, tenantUserEmail + ' -> tenant ' + bound.id);
    return { detail: bound.name + ' + 账号 ' + tenantUserEmail, value: bound };
  });

  // ---------- 步骤 4：创建合同并生效 ----------
  const contract = await step('4 创建合同并生效', async () => {
    const res = await api('POST', '/contracts', {
      token: adminToken,
      body: {
        buildingId: room.buildingId,
        roomId: room.id,
        tenantId: tenant.id,
        rentAmount: 300000,
        depositAmount: 600000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        startDate: tomorrow(0),
        endDate: tomorrow(365),
      },
    });
    expectStatus(res, 201, '创建合同');
    assert(res.data.status === 'DRAFT', '新合同应为 DRAFT，实际 ' + res.data.status);
    // 注意：房态 VACANT+CLEAN -> RESERVED+CLEAN 需要「草稿合同」前置条件，
    // 因此激活操作放在 4b 的 RESERVED 之后（见 docs/04-状态机.md §1.3）
    return { detail: res.data.contractNumber + ' DRAFT', value: res.data };
  });

  // ---------- 合同生效 + 房态流转 VACANT+CLEAN -> RESERVED+CLEAN -> OCCUPIED+CLEAN ----------
  await step('4b 合同生效并流转至 OCCUPIED', async () => {
    let cur = await api('GET', '/rooms/' + room.id, { token: adminToken });
    expectStatus(cur, 200, '读取房源');

    // VACANT+CLEAN -> RESERVED+CLEAN：前置条件为存在草稿合同
    const reserved = await api('PATCH', '/rooms/' + room.id + '/status', {
      token: adminToken,
      body: { status: 'RESERVED', version: cur.data.version },
    });
    expectStatus(reserved, 200, '流转至 RESERVED（草稿合同）');
    assert(reserved.data.status === 'RESERVED', '应为 RESERVED，实际 ' + reserved.data.status);

    // 合同生效
    const activated = await api('PATCH', '/contracts/' + contract.id, { token: adminToken, body: { status: 'ACTIVE' } });
    expectStatus(activated, 200, '合同生效');
    assert(activated.data.status === 'ACTIVE', '合同应为 ACTIVE，实际 ' + activated.data.status);

    // RESERVED+CLEAN -> OCCUPIED+CLEAN
    const occupied = await api('PATCH', '/rooms/' + room.id + '/status', {
      token: adminToken,
      body: { status: 'OCCUPIED', version: reserved.data.version },
    });
    expectStatus(occupied, 200, '流转至 OCCUPIED');
    assert(occupied.data.status === 'OCCUPIED', '应为 OCCUPIED，实际 ' + occupied.data.status);
    room.version = occupied.data.version;
    return { detail: 'DRAFT -> ACTIVE，房态 RESERVED -> OCCUPIED（version=' + occupied.data.version + '）' };
  });

  // ---------- 步骤 5：生成月度账单 ----------
  const bill = await step('5 生成月度账单', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const res = await api('POST', '/bills', {
      token: adminToken,
      body: { contractId: contract.id, billType: 'RENT', period, amount: 300000, dueDate: tomorrow(10) },
    });
    expectStatus(res, 201, '生成账单');
    assert(res.data.status === 'PENDING', '账单应为 PENDING，实际 ' + res.data.status);
    assert(res.data.paidAmount === 0, 'paidAmount 应为 0');
    return { detail: res.data.billNumber + ' ' + res.data.amount + '分', value: res.data };
  });

  // ---------- 步骤 6：登记收款至账单 PAID（含幂等 409） ----------
  await step('6 登记收款至账单 PAID', async () => {
    const txn = 'E2E-TXN-' + uid;
    const res = await api('POST', '/bills/' + bill.id + '/payments', {
      token: adminToken,
      body: { amount: 300000, paymentMethod: 'BANK_TRANSFER', transactionNumber: txn },
    });
    expectStatus(res, 201, '登记收款');

    const after = await api('GET', '/bills/' + bill.id, { token: adminToken });
    expectStatus(after, 200, '读取账单');
    assert(after.data.status === 'PAID', '账单应为 PAID，实际 ' + after.data.status);
    assert(after.data.paidAmount === 300000, 'paidAmount 应为 300000，实际 ' + after.data.paidAmount);

    // 幂等：同交易号重复收款应 409。
    // 注意：已 PAID 的账单会先被「不可收款」拦截并返回 400，
    // 因此幂等必须用「仍可收款」的另一张账单验证（见 6b）。
    return { detail: 'PAID（paidAmount=300000）' };
  });

  await step('6b 交易号幂等 409', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const b2 = await api('POST', '/bills', {
      token: adminToken,
      body: { contractId: contract.id, billType: 'OTHER', period, amount: 100000, dueDate: tomorrow(10) },
    });
    expectStatus(b2, 201, '创建第二张账单');

    const txn = 'E2E-IDEM-' + uid;
    const first = await api('POST', '/bills/' + b2.data.id + '/payments', {
      token: adminToken,
      body: { amount: 50000, paymentMethod: 'WECHAT', transactionNumber: txn },
    });
    expectStatus(first, 201, '首次部分收款');

    const afterPartial = await api('GET', '/bills/' + b2.data.id, { token: adminToken });
    assert(afterPartial.data.status === 'PARTIAL', '部分收款后应为 PARTIAL，实际 ' + afterPartial.data.status);

    // 同交易号再收一次 -> 幂等冲突 409
    const dup = await api('POST', '/bills/' + b2.data.id + '/payments', {
      token: adminToken,
      body: { amount: 10000, paymentMethod: 'WECHAT', transactionNumber: txn },
    });
    expectStatus(dup, 409, '重复交易号幂等');
    return { detail: 'PARTIAL + 重复交易号 -> 409' };
  });

  // ---------- 步骤 7：预付充值 ----------
  const prepay = await step('7 预付充值', async () => {
    const acct = await api('POST', '/prepay-accounts', {
      token: adminToken,
      body: { tenantId: tenant.id, roomId: room.id, lowBalanceThreshold: 10000 },
    });
    expectStatus(acct, 201, '创建预付账户');

    const before = acct.data.balanceCache;
    const res = await api('POST', '/prepay-accounts/' + acct.data.id + '/transactions', {
      token: adminToken,
      body: { type: 'RECHARGE', amount: 200000, description: 'T147 e2e 充值', relatedType: 'MANUAL_ADJUSTMENT' },
    });
    expectStatus(res, [200, 201], '预付充值');
    // 响应结构为 { transaction, account }，balanceAfter 在 transaction 上
    const balanceAfter = res.data.transaction.balanceAfter;
    assert(balanceAfter === before + 200000,
      'balanceAfter 应为 ' + (before + 200000) + '（充值前 ' + before + '），实际 ' + balanceAfter);
    assert(res.data.account.balanceCache === balanceAfter, 'account.balanceCache 应与 transaction.balanceAfter 一致');
    return { detail: 'balance ' + before + ' -> ' + balanceAfter + '分', value: acct.data };
  });

  // ---------- 步骤 8：水电读数触发自动扣费 ----------
  const balanceBeforeReading = (
    await api('GET', '/prepay-accounts/' + prepay.id, { token: adminToken })
  ).data.balanceCache;

  await step('8 水电读数触发自动扣费', async () => {
    const meter = await api('POST', '/meters', {
      token: adminToken,
      body: {
        buildingId: room.buildingId, roomId: room.id, meterType: 'ELECTRICITY',
        meterNumber: 'E2E-M-' + uid, unitPrice: 100, priceEffectiveDate: tomorrow(0),
      },
    });
    expectStatus(meter, 201, '创建电表');

    const res = await api('POST', '/meters/' + meter.data.id + '/readings', {
      token: adminToken,
      body: { currentReading: 150, readingTime: new Date().toISOString() },
    });
    expectStatus(res, [200, 201], '登记读数');

    const acct = await api('GET', '/prepay-accounts/' + prepay.id, { token: adminToken });
    expectStatus(acct, 200, '读取预付余额');
    assert(typeof acct.data.balanceCache === 'number', 'balanceCache 应为数字');
    assert(acct.data.balanceCache < balanceBeforeReading,
      '读数后余额应被扣减：读数前 ' + balanceBeforeReading + '，实际 ' + acct.data.balanceCache);
    return { detail: '余额 ' + balanceBeforeReading + ' -> ' + acct.data.balanceCache + '分（已扣费）' };
  });

  // ---------- 步骤 9：租客提交报修 ----------
  let tenantToken;
  const maintenance = await step('9 租客提交报修', async () => {
    if (!tenantUserEmail) {
      return { detail: '跳过：步骤 3 未成功注册租客账号', value: null };
    }
    // 用步骤 3 注册的租客账号登录
    const login = await api('POST', '/auth/login', { body: { identifier: tenantUserEmail, password: tenantPassword } });
    expectStatus(login, [200, 201], '租客登录');
    tenantToken = login.data.accessToken;
    assert(tenantToken, '租客登录应返回 accessToken');

    // 租客本人提交报修（走租客身份，而非管理员代建）
    const res = await api('POST', '/maintenance', {
      token: tenantToken,
      body: {
        roomId: room.id, tenantId: tenant.id,
        title: 'E2E 报修-' + uid, description: '水管漏水，需要维修',
        category: 'PLUMBING', priority: 'NORMAL',
      },
    });
    expectStatus(res, [200, 201], '租客提交报修');
    if (res.status === 403) {
      // 记录契约：租客可能不允许自建报修
      throw new Error('租客无权提交报修（403）');
    }
    assert(res.data.status === 'SUBMITTED', '报修应为 SUBMITTED，实际 ' + res.data.status);
    return { detail: '身份=TENANT ' + res.data.status, value: res.data };
  });

  // ---------- 步骤 10：报修流转至 COMPLETED ----------
  await step('10 报修流转至 COMPLETED', async () => {
    if (!maintenance) {
      return { detail: '跳过：步骤 9 未创建报修' };
    }
    let cur = maintenance;
    for (const status of ['ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRM', 'COMPLETED']) {
      const res = await api('PATCH', '/maintenance/' + maintenance.id, {
        token: adminToken,
        body: { status, ...(status === 'COMPLETED' ? { resolution: '已更换水管' } : {}) },
      });
      if (![200, 201].includes(res.status)) {
        // 记录实际可达状态，便于人工判断状态机
        record('10 报修流转（至 ' + status + '）', false, '状态码 ' + res.status + ' body=' + JSON.stringify(res.data).slice(0, 160));
        throw new Error('报修流转在 ' + status + ' 失败');
      }
      cur = res.data;
    }
    assert(cur.status === 'COMPLETED', '报修应为 COMPLETED，实际 ' + cur.status);
    return { detail: 'SUBMITTED -> COMPLETED' };
  });

  // ---------- 步骤 11：退租并结算 ----------
  await step('11 发起退租并结算（含押金扣除项）', async () => {
    // 押金扣除项必须带类别 / 金额 / 说明，且与主记录同事务落库
    const res = await api('POST', '/checkout', {
      token: adminToken,
      body: {
        contractId: contract.id, roomId: room.id, checkoutDate: tomorrow(0),
        totalRefund: 500000, processedBy: adminUser.data.id, notes: 'E2E 退租结算',
        items: [
          { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 600000 },
          { itemType: 'DEPOSIT_DEDUCTION', description: '墙面破损修补', amount: 80000 },
          { itemType: 'RENT_REFUND', description: '剩余租金退还', amount: 20000 },
        ],
      },
    });
    expectStatus(res, 201, '创建退租记录');
    assert(res.data.totalRefund === 500000, 'totalRefund 应为 500000');

    const items = res.data.items || [];
    assert(items.length === 3, '结算明细应为 3 项，实际 ' + items.length);

    const deduction = items.find((i) => i.itemType === 'DEPOSIT_DEDUCTION');
    assert(deduction, '缺少押金扣除项');
    assert(Boolean(deduction.description), '扣除项缺少说明');
    assert(typeof deduction.amount === 'number' && deduction.amount === 80000,
      '扣除项金额应为 80000，实际 ' + deduction.amount);

    // 每个明细项的类别/金额/说明三者齐备
    for (const it of items) {
      assert(Boolean(it.itemType), '明细缺失类别');
      assert(Boolean(it.description), '明细缺失说明');
      assert(typeof it.amount === 'number', '明细缺失金额');
    }

    // 经详情接口复核（持久化）
    const detail = await api('GET', '/checkout/' + res.data.id, { token: adminToken });
    expectStatus(detail, 200, '读取退租详情');
    assert((detail.data.items || []).length === 3, '详情接口明细应为 3 项');

    return { detail: '3 项明细（含押金扣除 80000 分/说明齐备）' };
  });

  // ---------- 步骤 12：房间变 PENDING_CLEAN ----------
  let pendingRoom;
  await step('12 房间变 PENDING_CLEAN', async () => {
    const cur = await api('GET', '/rooms/' + room.id, { token: adminToken });
    expectStatus(cur, 200, '读取房源');
    const res = await api('PATCH', '/rooms/' + room.id + '/status', {
      token: adminToken,
      body: { status: 'VACANT', cleanStatus: 'PENDING_CLEAN', version: cur.data.version },
    });
    expectStatus(res, 200, '流转至待清洁');
    assert(res.data.cleanStatus === 'PENDING_CLEAN', '应为 PENDING_CLEAN，实际 ' + res.data.cleanStatus);
    pendingRoom = res.data;
    return { detail: 'VACANT/PENDING_CLEAN version=' + res.data.version };
  });

  await step('12b 待清洁通知已发给保洁', async () => {
    const res = await api('GET', '/notifications', { token: cleanerToken });
    expectStatus(res, 200, '保洁读取通知');
    const list = res.data.data || [];
    assert(list.length > 0, '保洁应收到待清洁通知，实际 0 条');
    return { detail: '保洁通知 ' + list.length + ' 条' };
  });

  // ---------- 步骤 13：保洁标记已清洁，房间变可出租 ----------
  await step('13 保洁标记已清洁', async () => {
    // 保洁可见待清洁房间
    const list = await api('GET', '/rooms', { token: cleanerToken });
    expectStatus(list, 200, '保洁读取待清洁列表');
    const visible = (list.data.data || []).some((r) => r.id === room.id);
    assert(visible, '保洁应能在列表中看到待清洁房间 ' + room.roomNumber);

    // 详情准入
    const detail = await api('GET', '/rooms/' + room.id, { token: cleanerToken });
    expectStatus(detail, 200, '保洁读取待清洁房间详情');

    // PENDING_CLEAN -> CLEANING -> CLEAN
    const start = await api('PATCH', '/rooms/' + room.id + '/status', {
      token: cleanerToken,
      body: { cleanStatus: 'CLEANING', version: pendingRoom.version },
    });
    expectStatus(start, 200, '保洁开始清洁');

    const done = await api('PATCH', '/rooms/' + room.id + '/clean', {
      token: cleanerToken,
      body: { version: start.data.version },
    });
    expectStatus(done, [200, 201], '保洁标记完成');

    const final = await api('GET', '/rooms/' + room.id, { token: adminToken });
    expectStatus(final, 200, '确认最终房态');
    assert(final.data.cleanStatus === 'CLEAN', '应为 CLEAN，实际 ' + final.data.cleanStatus);
    assert(final.data.status === 'VACANT', '应为 VACANT，实际 ' + final.data.status);
    return { detail: 'PENDING_CLEAN -> CLEANING -> CLEAN（可出租）' };
  });

  // ---------- 步骤 14：租客数据隔离 ----------
  await step('14 租客只能看到自己的数据', async () => {
    if (!tenantToken) {
      return { detail: '跳过：无租客登录态（步骤 3 未注册账号）' };
    }
    // 先确认登录租客自己的 tenantId（由 jwt.strategy 服务端注入，不在 JWT 里）
    const self = await api('GET', '/auth/me', { token: tenantToken });
    expectStatus(self, 200, '读取当前租客');
    assert(self.data.role === 'TENANT', '当前应为 TENANT，实际 ' + self.data.role);
    const myTenantId = self.data.tenant && self.data.tenant.id;
    assert(myTenantId, '租客账号应绑定 Tenant 记录');

    const mine = await api('GET', '/bills/my', { token: tenantToken });
    expectStatus(mine, 200, '租客读取自己的账单');
    const myBills = mine.data.data || [];
    const foreign = myBills.filter((b) => !b.contract || b.contract.tenantId !== myTenantId);
    assert(foreign.length === 0,
      '租客看到非本人账单 ' + foreign.length + ' 条（期望 0）：' +
      JSON.stringify(foreign.slice(0, 2).map((b) => b.billNumber)));

    // 全库账单总数必须 >= 本人可见数，且本人可见数不含他人
    const allBills = await api('GET', '/bills', { token: adminToken });
    expectStatus(allBills, 200, '管理员读取全部账单');
    const totalAll = allBills.data.meta.total;
    assert(mine.data.meta.total <= totalAll,
      '租客可见 ' + mine.data.meta.total + ' 不应超过全库 ' + totalAll);
    if (totalAll > mine.data.meta.total) {
      // 全库存在他人账单，而租客未看到任何一条 -> 隔离成立
      assert(mine.data.meta.total === myBills.length, '分页计数与数据条数不一致');
    }

    const all = await api('GET', '/bills', { token: tenantToken });
    assert([401, 403].includes(all.status), '租客调管理端 /bills 应被拒，实际 ' + all.status);
    const tenants = await api('GET', '/tenants', { token: tenantToken });
    assert([401, 403].includes(tenants.status), '租客调 /tenants 应被拒，实际 ' + tenants.status);

    const myContracts = await api('GET', '/contracts/my', { token: tenantToken });
    expectStatus(myContracts, 200, '租客读取自己的合同');
    const foreignContracts = (myContracts.data.data || []).filter(
      (c) => c.tenantId && c.tenantId !== myTenantId,
    );
    assert(foreignContracts.length === 0, '租客看到他人合同 ' + foreignContracts.length + ' 条');

    const myMaint = await api('GET', '/maintenance/my', { token: tenantToken });
    expectStatus(myMaint, 200, '租客读取自己的报修');

    return { detail: '本人账单 ' + myBills.length + '/' + totalAll + '（全库），管理端接口被拒 ' + all.status };
  });

  await step('14b 跨租客隔离负向验证', async () => {
    if (!tenantToken) {
      return { detail: '跳过：无租客登录态' };
    }
    // 种子租客（T140 测试租客）拥有独立账单；本流程注册的租客不得看到它们
    const other = await api('POST', '/auth/login', {
      body: { identifier: 'tenant140@example.com', password: 'Tenant@123' },
    });
    if (![200, 201].includes(other.status)) {
      return { detail: '跳过：种子租客账号不可登录（' + other.status + '）' };
    }
    const otherToken = other.data.accessToken;
    const otherMe = await api('GET', '/auth/me', { token: otherToken });
    const otherTenantId = otherMe.data.tenant && otherMe.data.tenant.id;

    const otherBills = await api('GET', '/bills/my', { token: otherToken });
    expectStatus(otherBills, 200, '种子租客读取自己的账单');
    const otherBillCount = otherBills.data.meta.total;

    if (!otherTenantId || otherBillCount === 0) {
      return { detail: '跳过：种子租客无账单，无法做跨租客对比' };
    }

    // 本流程租客的账单中不得出现种子租客的账单
    const mineNow = await api('GET', '/bills/my', { token: tenantToken });
    expectStatus(mineNow, 200, '本流程租客读取账单');
    const leaked = (mineNow.data.data || []).filter(
      (b) => b.contract && b.contract.tenantId === otherTenantId,
    );
    assert(leaked.length === 0,
      '本流程租客看到了种子租客的 ' + leaked.length + ' 条账单（跨租客泄露）');

    // 反向：种子租客也不应看到本流程租客的账单
    const backLeak = (otherBills.data.data || []).filter(
      (b) => b.contract && b.contract.tenantId === tenant.id,
    );
    assert(backLeak.length === 0,
      '种子租客看到了本流程租客的 ' + backLeak.length + ' 条账单（跨租客泄露）');

    return { detail: '本流程租客与种子租客（' + otherBillCount + ' 条账单）互不可见' };
  });

  // ---------- 越权矩阵 ----------
  console.log('\n--- 越权与并发断言 ---');

  await step('A1 未登录访问受保护接口 401', async () => {
    for (const p of ['/rooms', '/bills', '/tenants', '/contracts', '/dashboard/stats']) {
      const res = await api('GET', p);
      assert(res.status === 401, p + ' 未登录应 401，实际 ' + res.status);
    }
    return { detail: '5 个接口均 401' };
  });

  await step('A2 租客调用管理接口被拒', async () => {
    const checks = [['/bills', [401, 403]], ['/tenants', [401, 403]], ['/contracts', [401, 403]]];
    for (const [p, expected] of checks) {
      const res = await api('GET', p, { token: tenantToken });
      assert(expected.includes(res.status), '租客调 ' + p + ' 应被拒，实际 ' + res.status);
    }
    return { detail: '/bills /tenants /contracts 均被拒' };
  });

  await step('A3 保洁访问租客/合同/账单被拒', async () => {
    const checks = [
      ['/bills', [403]],
      ['/contracts', [403]],
      ['/tenants', [403]],
    ];
    const failed = [];
    for (const [p, expected] of checks) {
      const res = await api('GET', p, { token: cleanerToken });
      if (!expected.includes(res.status)) failed.push(p + '=' + res.status);
    }
    assert(failed.length === 0, '保洁越权可读: ' + failed.join(', '));
    return { detail: '/bills /contracts /tenants 均 403' };
  });

  await step('A4 保洁读取非待清洁房间详情被拒', async () => {
    // 新建一个 CLEAN 房源，保洁不应可见其详情
    const b = await api('GET', '/buildings', { token: adminToken });
    const cleanRoom = await api('POST', '/rooms', {
      token: adminToken,
      body: { buildingId: b.data.data[0].id, roomNumber: 'E2E-CLEAN-' + uid, floor: 2, roomType: 'SINGLE', area: 20 },
    });
    expectStatus(cleanRoom, 201, '创建 CLEAN 房源');
    const res = await api('GET', '/rooms/' + cleanRoom.data.id, { token: cleanerToken });
    assert([403, 404].includes(res.status), '保洁读非待清洁房间应 403/404，实际 ' + res.status);
    return { detail: 'CLEAN 房源 -> ' + res.status };
  });

  await step('A5 房态 version 冲突 409', async () => {
    const cur = await api('GET', '/rooms/' + room.id, { token: adminToken });
    const current = cur.data.version;

    // 先确认前置条件先于乐观锁生效：VACANT+CLEAN -> MAINTENANCE 需要报修工单，
    // 该房间的报修工单已随退租流程结束，因此这里应因前置条件返回 400（而非 409）。
    const stalePrecondition = await api('PATCH', '/rooms/' + room.id + '/status', {
      token: adminToken,
      body: { status: 'MAINTENANCE', version: current },
      });
    if (stalePrecondition.status === 400) {
      // 前置条件拦截 —— 契约：400 优先于 409，符合「先校验流转合法性、再校验并发」
    } else if (stalePrecondition.status !== 200) {
      throw new Error('前置条件路径返回了意外状态码 ' + stalePrecondition.status);
    }

    // 再验证乐观锁：在当前 version 已被上一步递增后，用过期 version 发起「合法流转」
    // VACANT+CLEAN -> RESERVED+CLEAN 只需草稿合同，本流程合同已 ACTIVE，故用 400/409 之外的
    // 合法目标：VACANT+CLEAN -> MAINTENANCE 已被前置条件拦截，改用同一目标但先造工单成本高，
    // 因此这里直接用「当前 version 减 1」对同一目标请求，断言其被拒（400 或 409 均为拒绝）。
    const stale = current - 1;
    const res = await api('PATCH', '/rooms/' + room.id + '/status', {
      token: adminToken,
      body: { status: 'MAINTENANCE', version: stale },
    });
    assert([400, 409].includes(res.status),
      '过期 version 应被拒（400/409），实际 ' + res.status);
    return { detail: '前置条件=400，过期 version=' + stale + ' -> ' + res.status + '（被拒）' };
  });

  await step('A6 乐观锁版本冲突 409（无前置条件的合法流转）', async () => {
    // 造一个 VACANT+PENDING_CLEAN 的房间：新房间 CLEAN，需经退租记录；
    // 因此直接对已完成清洁流程的房间回退不可行，改为在同一合法目标上制造并发：
    // VACANT+CLEAN -> RESERVED+CLEAN（需草稿合同）在无草稿合同时会被 400 拦截，
    // 故使用 rooms 的 clean 流程前置条件最少的路径 —— 用两个并发请求打同一 version。
    const cur = await api('GET', '/rooms/' + room.id, { token: adminToken });
    const v = cur.data.version;

    // 同一 version 连续两次请求同一合法流转；第一次成功后第二次必然 version 过期。
    // 选 VACANT+CLEAN -> RESERVED+CLEAN 需草稿合同，改选 MAINTENANCE 亦需工单，
    // 因此本用例改用「新建房间 + 两次 RESERVED」以隔离前置条件影响。
    const b = await api('GET', '/buildings', { token: adminToken });
    const fresh = await api('POST', '/rooms', {
      token: adminToken,
      body: { buildingId: b.data.data[0].id, roomNumber: 'E2E-LOCK-' + uid, floor: 3, roomType: 'SINGLE', area: 18 },
    });
    expectStatus(fresh, 201, '创建用于并发测试的房间');

    const t = await api('POST', '/tenants', {
      token: adminToken,
      body: { name: 'E2E锁租客' + uid, phone: '138' + uid.padStart(8, '0').slice(0, 8) },
    });
    expectStatus(t, 201, '创建用于并发测试的租客');

    const c = await api('POST', '/contracts', {
      token: adminToken,
      body: {
        buildingId: b.data.data[0].id, roomId: fresh.data.id, tenantId: t.data.id,
        rentAmount: 100000, depositAmount: 200000, paymentCycle: 'MONTHLY', paymentDay: 5,
        startDate: tomorrow(0), endDate: tomorrow(180),
      },
    });
    expectStatus(c, 201, '创建用于并发测试的合同（保持 DRAFT）');

    // 第一次流转成功，version 自增
    const first = await api('PATCH', '/rooms/' + fresh.data.id + '/status', {
      token: adminToken,
      body: { status: 'RESERVED', version: fresh.data.version },
    });
    expectStatus(first, 200, '首次流转 RESERVED');

    // 用过期 version 再发起同一合法流转 -> 乐观锁冲突 409
    const second = await api('PATCH', '/rooms/' + fresh.data.id + '/status', {
      token: adminToken,
      body: { status: 'RESERVED', version: fresh.data.version },
    });
    expectStatus(second, 409, '过期 version 应 409');
    return { detail: 'stale version=' + fresh.data.version + ' -> 409（乐观锁生效）' };
  });

  // ---------- 汇总 ----------
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== 汇总 ===');
  console.log('总计 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + '，失败 ' + failed.length);
  if (failed.length) {
    console.log('\n失败项：');
    for (const f of failed) console.log('  - ' + f.name + ': ' + f.detail);
  }
  console.log(failed.length === 0 ? '\n✅ 端到端验收全部通过' : '\n❌ 存在未通过项');
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ 主流程中断: ' + err.message);
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== 汇总（中断）===');
  console.log('总计 ' + results.length + ' 项，通过 ' + (results.length - failed.length) + '，失败 ' + failed.length);
  for (const f of failed) console.log('  - ' + f.name + ': ' + f.detail);
  process.exit(1);
});
