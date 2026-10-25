import { request as baseRequest, expect } from '@playwright/test';

/** 后端 API 根地址（CI :3000，本地开发多为 :3100） */
export const API_BASE = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:3100/api';

export const ADMIN = { identifier: 'admin@example.com', password: 'Admin@123' };

/** 每次运行唯一后缀，避免与历史数据碰撞 */
export function uid() {
  return Date.now().toString(36).slice(-6) + Math.floor(Math.random() * 1296).toString(36);
}

async function apiContext() {
  // baseURL 必须以 / 结尾，否则相对路径会替换掉 /api 段（WHATWG URL 合并语义）
  const base = API_BASE.endsWith('/') ? API_BASE : `${API_BASE}/`;
  const req = await baseRequest.newContext({ baseURL: base });
  const login = await req.post('auth/login', { data: ADMIN });
  if (login.status() !== 201) throw new Error('fixture 管理员登录失败: ' + login.status());
  const { accessToken } = await login.json();
  return { req, headers: { Authorization: `Bearer ${accessToken}` } };
}

export interface FlowData {
  uid: string;
  buildingId: string;
  room: any;
  tenant: any;
  contract: any;
}

/**
 * 预置“房间 + 租客 + 已生效合同（房态 OCCUPIED）”一条龙。
 * 与 scripts/e2e-mvp/run.mjs 步骤 2/3/4/4b 同序，保证月度账单/抄表/退租前置成立。
 */
export async function setupActiveContract(tag = 'PW'): Promise<FlowData> {
  const id = tag + '-' + uid();
  const { req, headers } = await apiContext();
  try {
    const buildings = await req.get('buildings', { headers });
    if (buildings.status() !== 200) throw new Error('读取楼栋失败: ' + buildings.status());
    const buildingId = (await buildings.json()).data[0].id;

    const roomNumber = 'PW' + id.replace(/[^a-z0-9]/gi, '').slice(-8);
    const roomRes = await req.post('rooms', {
      headers,
      data: { buildingId, roomNumber, floor: 3, roomType: 'SINGLE', area: 22.5 },
    });
    if (roomRes.status() !== 201) throw new Error('创建房源失败: ' + roomRes.status());
    const room = await roomRes.json();

    const phone = '139' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const tenantRes = await req.post('tenants', {
      headers,
      data: { name: 'PW租客' + id.slice(-4), phone },
    });
    if (tenantRes.status() !== 201) throw new Error('创建租客失败: ' + tenantRes.status());
    const tenant = await tenantRes.json();

    const start = new Date();
    const end = new Date(Date.now() + 365 * 86400000);
    const contractRes = await req.post('contracts', {
      headers,
      data: {
        buildingId,
        roomId: room.id,
        tenantId: tenant.id,
        rentAmount: 300000,
        depositAmount: 600000,
        paymentCycle: 'MONTHLY',
        paymentDay: 5,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
    });
    if (contractRes.status() !== 201) throw new Error('创建合同失败: ' + contractRes.status());
    const contract = await contractRes.json();

    // 房态 VACANT -> RESERVED（需 version）-> 合同 ACTIVE -> 房态 OCCUPIED
    const curRoom = await (await req.get(`rooms/${room.id}`, { headers })).json();
    const reserved = await req.patch(`rooms/${room.id}/status`, {
      headers,
      data: { status: 'RESERVED', version: curRoom.version },
    });
    if (reserved.status() !== 200) throw new Error('房态 RESERVED 失败: ' + reserved.status());
    const reservedBody = await reserved.json();
    const activated = await req.patch(`contracts/${contract.id}`, {
      headers,
      data: { status: 'ACTIVE' },
    });
    if (activated.status() !== 200) throw new Error('合同生效失败: ' + activated.status());
    // 合同生效的副作用已把房间从 RESERVED 随动到 OCCUPIED（docs/04 §2.3，T207 起 API 也实现），
    // 再发一次房态流转会带旧 version 撞乐观锁 409。这里改为断言副作用确实发生（T212）。
    const afterActivate = await req.get(`rooms/${room.id}`, { headers });
    if (afterActivate.status() !== 200) throw new Error('合同生效后读取房源失败: ' + afterActivate.status());
    const afterActivateBody = await afterActivate.json();
    if (afterActivateBody.status !== 'OCCUPIED') {
      throw new Error('合同生效后房间应随动为 OCCUPIED，实际 ' + afterActivateBody.status);
    }
    if (!(afterActivateBody.version > reservedBody.version)) {
      throw new Error('房间随动应使 version 递增，实际 ' + afterActivateBody.version);
    }

    return { uid: id, buildingId, room, tenant, contract: { ...contract, status: 'ACTIVE' } };
  } finally {
    await req.dispose();
  }
}

/** 创建一条 PENDING 租金账单（账期当月，金额唯一避免跨运行碰撞） */
export async function createPendingBill(contractId: string, suffix: string) {
  const { req, headers } = await apiContext();
  try {
    const period = new Date().toISOString().slice(0, 7);
    const amount = 280000 + (Math.floor(Math.random() * 9000) + 1000);
    const res = await req.post('bills', {
      headers,
      data: {
        contractId,
        billType: 'RENT',
        period: `${period}-${suffix}`,
        amount,
        dueDate: new Date(Date.now() + 10 * 86400000).toISOString(),
      },
    });
    if (res.status() !== 201) throw new Error('创建账单失败: ' + res.status());
    return await res.json();
  } finally {
    await req.dispose();
  }
}

/** 创建一块已启用电表（无读数） */
export async function createMeter(buildingId: string, roomId: string, suffix: string) {
  const { req, headers } = await apiContext();
  try {
    const res = await req.post('meters', {
      headers,
      data: {
        buildingId,
        roomId,
        meterType: 'ELECTRICITY',
        meterNumber: `PWM${suffix.replace(/[^a-z0-9]/gi, '').slice(-8)}`,
        unitPrice: 100,
        priceEffectiveDate: new Date().toISOString(),
      },
    });
    if (res.status() !== 201) throw new Error('创建电表失败: ' + res.status() + ' ' + (await res.text()).slice(0, 200));
    return await res.json();
  } finally {
    await req.dispose();
  }
}

/** 创建预付账户并充值（抄表扣费/结算前置） */
export async function ensurePrepayFunded(tenantId: string, roomId: string, amount = 200000) {
  const { req, headers } = await apiContext();
  try {
    const acct = await req.post('prepay-accounts', {
      headers,
      data: { tenantId, roomId, lowBalanceThreshold: 10000 },
    });
    if (acct.status() !== 201) throw new Error('创建预付账户失败: ' + acct.status());
    const { id } = await acct.json();
    const tx = await req.post(`prepay-accounts/${id}/transactions`, {
      headers,
      data: { type: 'RECHARGE', amount, description: 'Playwright e2e 充值', relatedType: 'MANUAL_ADJUSTMENT' },
    });
    if (![200, 201].includes(tx.status())) throw new Error('预付充值失败: ' + tx.status());
  } finally {
    await req.dispose();
  }
}

/** 直接登记读数（autoSettle 可控，供结算前置使用） */
export async function setupDepositLedger(contractId: string, amount = 600000) {
  const { req, headers } = await apiContext();
  try {
    const period = new Date().toISOString().slice(0, 7);
    const billRes = await req.post('bills', {
      headers,
      data: {
        contractId,
        billType: 'DEPOSIT',
        period: `${period}-DEP-${uid().slice(-4)}`,
        amount,
        dueDate: new Date(Date.now() + 10 * 86400000).toISOString(),
      },
    });
    if (billRes.status() !== 201) throw new Error('创建押金账单失败: ' + billRes.status());
    const bill = await billRes.json();
    const payRes = await req.post(`bills/${bill.id}/payments`, {
      headers,
      data: {
        amount,
        paymentMethod: 'BANK_TRANSFER',
        transactionNumber: `DEP-TXN-${uid()}`,
      },
    });
    if (payRes.status() !== 201) throw new Error('押金账单收款失败: ' + payRes.status());
  } finally {
    await req.dispose();
  }
}

export async function postReading(meterId: string, currentReading: number, opts: { autoSettle?: boolean; readingTime?: string } = {}) {
  const { req, headers } = await apiContext();
  try {
    const res = await req.post(`meters/${meterId}/readings`, {
      headers,
      data: { currentReading, readingTime: opts.readingTime ?? new Date().toISOString(), ...(opts.autoSettle !== undefined ? { autoSettle: opts.autoSettle } : {}) },
    });
    if (![200, 201].includes(res.status())) throw new Error('登记读数失败: ' + res.status());
    return await res.json();
  } finally {
    await req.dispose();
  }
}

/** UI 登录（每个 spec 独立登录：refresh token 单次轮换，禁止跨 spec 复用 storageState） */
export async function loginAsAdmin(page: any) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱或手机号').fill(ADMIN.identifier);
  await page.getByPlaceholder('请输入密码').fill(ADMIN.password);
  await page.getByRole('button', { name: '进入运营中心' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 15000 });
}

export { expect };
