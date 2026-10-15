#!/usr/bin/env node
/**
 * 落地页演示数据种子
 *
 * 用途：为落地页的产品截图准备一套「真实感」数据集。
 * 只写入独立的 tenant_demo 库，**不会**触碰开发库 tenant_system。
 *
 * 用法：
 *   docker exec tenant-system-postgres-t140 psql -U tenant_user -d postgres -c "CREATE DATABASE tenant_demo;"
 *   cd backend && DATABASE_URL="postgresql://tenant_user:tenant_password@localhost:5434/tenant_demo?schema=public" npx prisma migrate deploy
 *   cd .. && DATABASE_URL="postgresql://tenant_user:tenant_password@localhost:5434/tenant_demo?schema=public" node landing/tools/demo_seed.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

// ---------------------------------------------------------------- 工具

/** 可复现的伪随机数（保证每次跑出的数据一致） */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261013);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

const NOW = new Date();
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
const CUR_Y = TODAY.getFullYear();
const CUR_M = TODAY.getMonth();

const dateOnly = (y, m, d) => new Date(y, m, d);
const monthKey = (y, m) => y + '-' + String(m + 1).padStart(2, '0');
const monthStart = (offset) => new Date(CUR_Y, CUR_M + offset, 1);
const yuan = (n) => Math.round(n * 100); // 元 → 分

// ---------------------------------------------------------------- 静态资料

const BUILDINGS = [
  { id: 'yunqi-a', name: '云栖公寓 · A 座', address: '杭州市西湖区文三路 199 号', floors: 6 },
  { id: 'yunqi-b', name: '云栖公寓 · B 座', address: '杭州市西湖区文三路 199 号', floors: 6 },
];

const ROOM_PLAN = [
  { no: 1, type: 'SINGLE', area: 18.5, rent: 1800, desc: '南向单间，独立卫浴，拎包入住' },
  { no: 2, type: 'SINGLE', area: 19.0, rent: 1850, desc: '北向单间，带独立阳台' },
  { no: 3, type: 'STUDIO', area: 24.5, rent: 2200, desc: '开间户型，开放式厨房，家电齐全' },
  { no: 4, type: 'ONE_BED', area: 36.0, rent: 3200, desc: '一室一厅，独立厨房与生活阳台' },
  { no: 5, type: 'ONE_BED', area: 38.5, rent: 3300, desc: '一室一厅，朝南全天采光' },
  { no: 6, type: 'TWO_BED', area: 52.0, rent: 4500, desc: '两室一厅，主卧朝南，适合合租' },
];
const FLOOR_ADJ = [-80, 0, 60, 120, 180, 240];

/** 房态排布（索引按「楼栋 → 楼层 → 房号」展开，共 72 间） */
const VACANT_CLEAN = new Set([3, 10, 17, 30, 41, 55]);
const RESERVED = new Set([24, 47]);
const PENDING_CLEAN = 63;
const CLEANING = 66;
const MAINTENANCE = 69;

const PHOTOS = [
  'photo-1722942116153-ee3aa0fc2153',
  'photo-1522708323590-d24dbb6b0267',
  'photo-1595526114035-0d45ed16cfbf',
  'photo-1583847268964-b28dc8f51f92',
  'photo-1759264244827-1dde5bee00a5',
  'photo-1616594039964-ae9021a400a0',
  'photo-1502672260266-1c1ef2d93688',
];
const photoUrl = (id, w) =>
  'https://images.unsplash.com/' + id + '?auto=format&fit=crop&w=' + w + '&q=80';

const SURNAMES = '陈林黄张李王吴刘蔡杨许郑谢郭洪曾廖赖徐周叶苏庄江吕何罗高萧潘朱简钟彭游詹胡施沈余卢梁宋方'.split('');
const GIVEN_1 = '嘉宇子雨佳思品雅诗彦志家怡柏文沐泓俊依家彦柏思品'.split('');
const GIVEN_2 = '豪轩萱宸然涵彤睿宁桦然岚宁彤睿辰桦轩涵豪宸岚'.split('');

const TENANT_NAMES = [];
const usedNames = new Set();
while (TENANT_NAMES.length < 80) {
  const n = pick(SURNAMES) + pick(GIVEN_1) + pick(GIVEN_2);
  if (!usedNames.has(n)) {
    usedNames.add(n);
    TENANT_NAMES.push(n);
  }
}

const MAINTENANCE_TEMPLATES = [
  { title: '卫生间水管渗水', category: 'PLUMBING', priority: 'URGENT', desc: '洗手台下方水管接口处持续渗水，地面已经有积水，麻烦尽快处理。' },
  { title: '厨房插座没电', category: 'ELECTRICAL', priority: 'NORMAL', desc: '厨房操作台左侧插座通电后没有反应，其他插座正常。' },
  { title: '空调制冷效果差', category: 'APPLIANCE', priority: 'NORMAL', desc: '空调开到 16 度运行一小时，房间温度仍然降不下来。' },
  { title: '衣柜门合页松动', category: 'FURNITURE', priority: 'LOW', desc: '衣柜右侧柜门合页松动，开关时会有异响。' },
  { title: '卧室窗户关不严', category: 'DOOR_WINDOW', priority: 'NORMAL', desc: '窗户上沿有缝隙，风大的时候会漏风并且有噪音。' },
  { title: '马桶水箱一直响', category: 'PLUMBING', priority: 'NORMAL', desc: '冲水后水箱持续有流水声，怀疑是进水阀老化。' },
  { title: '客厅吸顶灯闪烁', category: 'ELECTRICAL', priority: 'LOW', desc: '吸顶灯打开后会不定期闪烁，怀疑是镇流器问题。' },
  { title: '热水器打不着火', category: 'APPLIANCE', priority: 'URGENT', desc: '燃气热水器完全打不着火，目前无法洗澡。' },
  { title: '入户门锁芯卡顿', category: 'DOOR_WINDOW', priority: 'URGENT', desc: '门锁插入钥匙后转动困难，需要反复尝试才能打开。' },
  { title: '阳台晾衣杆脱落', category: 'OTHER', priority: 'LOW', desc: '阳台升降晾衣杆一侧钢丝绳脱落，暂时无法晾晒。' },
  { title: '墙面返潮起皮', category: 'OTHER', priority: 'LOW', desc: '靠窗墙面出现返潮和起皮，面积约一个巴掌大。' },
  { title: '洗衣机脱水异响', category: 'APPLIANCE', priority: 'NORMAL', desc: '洗衣机脱水阶段震动明显并且有金属摩擦声。' },
  { title: '下水道返味', category: 'PLUMBING', priority: 'NORMAL', desc: '卫生间地漏返味明显，已经更换过地漏芯仍然存在。' },
  { title: '床头阅读灯不亮', category: 'ELECTRICAL', priority: 'LOW', desc: '床头阅读灯灯泡已更换但仍然不亮。' },
];

// ---------------------------------------------------------------- 主流程

async function main() {
  console.log('🧹 清空 tenant_demo 库…');
  // 依赖顺序：子表 → 父表
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.deviceToken.deleteMany(),
    prisma.maintenancePhoto.deleteMany(),
    prisma.maintenanceRequest.deleteMany(),
    prisma.meterReading.deleteMany(),
    prisma.meter.deleteMany(),
    prisma.prepayTransaction.deleteMany(),
    prisma.prepayAccount.deleteMany(),
    prisma.lateFee.deleteMany(),
    prisma.paymentRecord.deleteMany(),
    prisma.bill.deleteMany(),
    prisma.checkoutItem.deleteMany(),
    prisma.checkoutRecord.deleteMany(),
    prisma.contractAttachment.deleteMany(),
    prisma.contract.deleteMany(),
    prisma.roomPhoto.deleteMany(),
    prisma.tenantRegistration.deleteMany(),
    prisma.tenant.deleteMany(),
    prisma.publicArea.deleteMany(),
    prisma.room.deleteMany(),
    prisma.building.deleteMany(),
    prisma.meterPriceHistory.deleteMany(),
    prisma.fileAsset.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // 1. 账号
  const adminHash = await bcrypt.hash('Admin@123', 10);
  const cleanerHash = await bcrypt.hash('Cleaner@123', 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@example.com', passwordHash: adminHash, role: 'ADMIN' },
  });
  const cleaner = await prisma.user.create({
    data: { email: 'cleaner@example.com', passwordHash: cleanerHash, role: 'CLEANER' },
  });
  console.log('✅ 账号：admin@example.com / cleaner@example.com');

  // 2. 楼栋
  for (const b of BUILDINGS) {
    await prisma.building.create({
      data: { id: b.id, name: b.name, address: b.address, floors: b.floors, metadata: { operator: '云栖公寓运营中心' } },
    });
  }

  // 3. 公共区域 + 水电单价
  const publicAreas = [];
  for (const b of BUILDINGS) {
    for (const pa of [
      { name: '1 层走廊', areaType: 'HALLWAY', floor: 1 },
      { name: '天台', areaType: 'ROOF', floor: null },
    ]) {
      publicAreas.push(
        await prisma.publicArea.create({ data: { buildingId: b.id, name: pa.name, areaType: pa.areaType, floor: pa.floor } }),
      );
    }
  }
  await prisma.meterPriceHistory.createMany({
    data: [
      { meterType: 'ELECTRICITY', unitPrice: 62, effectiveDate: dateOnly(CUR_Y, CUR_M - 6, 1), createdBy: admin.id },
      { meterType: 'WATER', unitPrice: 350, effectiveDate: dateOnly(CUR_Y, CUR_M - 6, 1), createdBy: admin.id },
    ],
  });

  // 4. 房间
  const rooms = [];
  let roomIdx = 0;
  for (const b of BUILDINGS) {
    for (let floor = 1; floor <= b.floors; floor++) {
      for (const plan of ROOM_PLAN) {
        const idx = roomIdx++;
        let status = 'OCCUPIED';
        let cleanStatus = 'CLEAN';
        if (VACANT_CLEAN.has(idx)) { status = 'VACANT'; cleanStatus = 'CLEAN'; }
        else if (RESERVED.has(idx)) { status = 'RESERVED'; }
        else if (idx === PENDING_CLEAN) { status = 'VACANT'; cleanStatus = 'PENDING_CLEAN'; }
        else if (idx === CLEANING) { status = 'VACANT'; cleanStatus = 'CLEANING'; }
        else if (idx === MAINTENANCE) { status = 'MAINTENANCE'; }

        const rent = plan.rent + FLOOR_ADJ[floor - 1];
        rooms.push({
          idx,
          buildingId: b.id,
          floor,
          roomNumber: String(floor) + String(plan.no).padStart(2, '0'),
          roomType: plan.type,
          area: plan.area,
          rent,
          description: plan.desc,
          status,
          cleanStatus,
        });
      }
    }
  }
  await prisma.room.createMany({
    data: rooms.map((r) => ({
      buildingId: r.buildingId, floor: r.floor, roomNumber: r.roomNumber, roomType: r.roomType,
      area: r.area, description: r.description, status: r.status, cleanStatus: r.cleanStatus,
      facilities: { wifi: true, airConditioner: true, washingMachine: true, waterHeater: true, desk: true },
    })),
  });
  const dbRooms = await prisma.room.findMany({
    where: { buildingId: { in: BUILDINGS.map((b) => b.id) } },
    select: { id: true, buildingId: true, floor: true, roomNumber: true },
  });
  const roomIdOf = (r) => {
    const hit = dbRooms.find((x) => x.buildingId === r.buildingId && x.floor === r.floor && x.roomNumber === r.roomNumber);
    return hit.id;
  };
  console.log('✅ 房间：' + rooms.length + ' 间（在租 ' + rooms.filter((r) => r.status === 'OCCUPIED').length + '）');

  // 5. 空置房源照片（公开看房页）
  const vacantRooms = rooms.filter((r) => VACANT_CLEAN.has(r.idx));
  let photoCursor = 0;
  for (const r of vacantRooms) {
    const roomId = roomIdOf(r);
    await prisma.roomPhoto.createMany({
      data: [0, 1, 2].map((k) => {
        const pid = PHOTOS[(photoCursor + k) % PHOTOS.length];
        return {
          roomId,
          fileUrl: photoUrl(pid, 1200),
          thumbnail: photoUrl(pid, 400),
          fileSize: 180000 + k * 12000,
          sortOrder: k,
        };
      }),
    });
    photoCursor += 3;
  }
  console.log('✅ 房源照片：' + vacantRooms.length * 3 + ' 张');

  // 6. 租客（每个房间一位）
  const housed = rooms.filter((r) => r.status === 'OCCUPIED' || r.status === 'RESERVED');
  const movedOut = rooms.filter((r) => [PENDING_CLEAN, CLEANING, MAINTENANCE].includes(r.idx) || [3, 10].includes(r.idx));

  const tenantRows = [];
  let ti = 0;
  for (const r of [...housed, ...movedOut]) {
    tenantRows.push({
      name: TENANT_NAMES[ti % TENANT_NAMES.length],
      phone: '138' + String(10000000 + ti * 137).slice(0, 8),
      email: null,
      tags: r.status === 'RESERVED' ? ['预订'] : pick([['长租'], ['应届生'], ['企业客户'], ['月付'], ['老租客']]),
      isActive: r.status === 'OCCUPIED' || r.status === 'RESERVED',
      roomIdx: r.idx,
    });
    ti++;
  }
  await prisma.tenant.createMany({ data: tenantRows.map((t) => ({
    name: t.name, phone: t.phone, tags: t.tags, isActive: t.isActive,
    emergencyContact: '家属', emergencyPhone: '139' + String(20000000 + t.roomIdx * 211).slice(0, 8),
  })) });
  const dbTenants = await prisma.tenant.findMany({ select: { id: true, phone: true } });
  const tenantIdOf = (phone) => dbTenants.find((t) => t.phone === phone).id;
  console.log('✅ 租客：' + tenantRows.length + ' 位（在租 ' + tenantRows.filter((t) => t.isActive).length + '）');

  // 7. 合同 + 账单 + 收款
  //    到期分布：越早入驻的合同越早签约，制造自然增长的收入曲线
  const ARRIVALS = [3, 5, 6, 7, 9, 10, 11, 10]; // 距今 8..1 个月前，每月新签数量（合计 61）
  const arrivePlan = []; // 展开成「第 n 个合同 → 几个月前入驻」
  ARRIVALS.forEach((count, i) => { for (let k = 0; k < count; k++) arrivePlan.push(8 - i); });

  const occupied = rooms.filter((r) => r.status === 'OCCUPIED');
  const contractRows = [];
  const shuffle = (arr) => arr.map((v) => [rand(), v]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const arrivalOrder = shuffle(arrivePlan);

  occupied.forEach((r, i) => {
    const monthsAgo = arrivalOrder[i] ?? 8;
    const start = monthStart(-monthsAgo);
    start.setDate(randInt(1, 26));
    const end = new Date(start); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
    const t = tenantRows.find((x) => x.roomIdx === r.idx);
    contractRows.push({
      roomIdx: r.idx, roomId: roomIdOf(r), buildingId: r.buildingId, tenantId: tenantIdOf(t.phone),
      rent: r.rent, start, end, monthsAgo, status: 'ACTIVE',
    });
  });
  // 预订：本月签订、下月入住
  for (const r of rooms.filter((x) => RESERVED.has(x.idx))) {
    const start = monthStart(1); start.setDate(randInt(1, 5));
    const end = new Date(start); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
    const t = tenantRows.find((x) => x.roomIdx === r.idx);
    contractRows.push({
      roomIdx: r.idx, roomId: roomIdOf(r), buildingId: r.buildingId, tenantId: tenantIdOf(t.phone),
      rent: r.rent, start, end, monthsAgo: 0, status: 'ACTIVE',
    });
  }
  // 已退租：为待清洁 / 清洁中 / 维修中 / 两间空置房间补历史合同
  for (const r of movedOut) {
    const monthsAgo = 4 + (r.idx % 5);
    const start = monthStart(-monthsAgo - 8); start.setDate(randInt(1, 26));
    const end = monthStart(-1); end.setDate(randInt(1, 20));
    const t = tenantRows.find((x) => x.roomIdx === r.idx);
    contractRows.push({
      roomIdx: r.idx, roomId: roomIdOf(r), buildingId: r.buildingId, tenantId: tenantIdOf(t.phone),
      rent: r.rent, start, end, monthsAgo: monthsAgo + 8, status: 'TERMINATED',
    });
  }

  await prisma.contract.createMany({
    data: contractRows.map((c, i) => ({
      buildingId: c.buildingId, roomId: c.roomId, tenantId: c.tenantId,
      contractNumber: 'HT' + CUR_Y + String(i + 1).padStart(4, '0'),
      rentAmount: yuan(c.rent), depositAmount: yuan(c.rent),
      paymentCycle: 'MONTHLY', paymentDay: randInt(1, 5),
      startDate: c.start, endDate: c.end,
      lateFeeRule: { graceDays: 3, dailyRate: 0.003, fixedDaily: null, cap: 50000 },
      status: c.status,
    })),
  });
  const dbContracts = await prisma.contract.findMany({
    select: { id: true, contractNumber: true, roomId: true, tenantId: true, rentAmount: true, startDate: true, endDate: true, status: true },
  });
  console.log('✅ 合同：' + dbContracts.length + ' 份（生效中 ' + dbContracts.filter((c) => c.status === 'ACTIVE').length + '）');

  // 账单：合同生效月起，每月一张租金账单
  const COLLECTION = { 5: 1.0, 4: 0.97, 3: 0.95, 2: 0.92, 1: 0.88, 0: 0.96 }; // key = 距今月数
  const billRows = [];
  const billMeta = [];
  const roomById = new Map(rooms.map((r) => [r.idx, r]));
  const roomIdToRoom = new Map(rooms.map((r) => [roomIdOf(r), r]));
  const tenantByRoomIdx = new Map(tenantRows.map((t) => [t.roomIdx, t]));

  let billSeq = 0;
  for (const c of dbContracts) {
    const room = roomIdToRoom.get(c.roomId);
    const start = new Date(c.startDate);
    const first = new Date(start.getFullYear(), start.getMonth(), 1);
    const totalMonths = (CUR_Y - first.getFullYear()) * 12 + (CUR_M - first.getMonth());
    const from = c.status === 'TERMINATED' ? Math.min(totalMonths, 6) : totalMonths;
    for (let off = Math.min(from, c.status === 'TERMINATED' ? 7 : 9); off >= 0; off--) {
      const mDate = monthStart(-off);
      if (mDate < first) continue;
      if (mDate > new Date(c.endDate)) continue;
      const period = monthKey(mDate.getFullYear(), mDate.getMonth());
      const dueDate = dateOnly(mDate.getFullYear(), mDate.getMonth(), randInt(6, 12));
      const overdue = dueDate < TODAY;
      const rate = COLLECTION[off] ?? 1.0;
      let status = 'PENDING';
      let paidAmount = 0;
      const r = rand();
      if (r < rate) { status = 'PAID'; paidAmount = c.rentAmount; }
      else if (r < rate + 0.05) { status = 'PARTIAL'; paidAmount = Math.round(c.rentAmount * 0.5 / 100) * 100; }
      else if (overdue) { status = 'OVERDUE'; }
      billSeq++;
      billRows.push({
        contractId: c.id,
        billNumber: 'ZD' + period.replace('-', '') + String(billSeq).padStart(4, '0'),
        billType: 'RENT', period,
        amount: c.rentAmount, paidAmount,
        snapshot: {
          contractNumber: c.contractNumber,
          buildingName: BUILDINGS.find((b) => b.id === room.buildingId).name,
          roomNumber: room.roomNumber,
          tenantName: tenantByRoomIdx.get(room.idx).name,
          rentAmount: c.rentAmount,
          paymentCycle: 'MONTHLY',
        },
        dueDate, status,
      });
    }
  }
  await prisma.bill.createMany({ data: billRows });
  const dbBills = await prisma.bill.findMany({ select: { id: true, billNumber: true, amount: true, paidAmount: true, status: true, dueDate: true, period: true } });
  console.log('✅ 账单：' + dbBills.length + ' 张');

  // 收款记录
  const METHODS = ['WECHAT', 'ALIPAY', 'BANK_TRANSFER', 'CASH'];
  const payments = [];
  let paySeq = 0;
  for (const b of dbBills) {
    if (b.paidAmount <= 0) continue;
    paySeq++;
    const d = new Date(b.dueDate);
    d.setDate(Math.max(1, d.getDate() - randInt(0, 5)));
    payments.push({
      billId: b.id, amount: b.paidAmount,
      paymentMethod: pick(METHODS),
      transactionNumber: 'TX' + b.period.replace('-', '') + String(paySeq).padStart(5, '0'),
      paidAt: new Date(d.getTime() + randInt(9, 19) * 3600000 + randInt(0, 59) * 60000),
      confirmedBy: admin.id,
      notes: null,
    });
  }
  await prisma.paymentRecord.createMany({ data: payments });
  console.log('✅ 收款记录：' + payments.length + ' 笔');

  // 滞纳金（逾期账单）
  const overdueBills = dbBills.filter((b) => b.status === 'OVERDUE');
  const lateFees = [];
  for (const b of overdueBills.slice(0, 6)) {
    const overdueDays = Math.max(1, Math.floor((TODAY - new Date(b.dueDate)) / 86400000));
    const base = b.amount - b.paidAmount;
    const suggested = Math.round(base * 0.003 * Math.max(0, overdueDays - 3));
    const confirmed = rand() < 0.6 ? suggested : null;
    const settled = confirmed !== null && rand() < 0.4 ? confirmed : null;
    lateFees.push({
      billId: b.id, suggestedAmount: suggested, confirmedAmount: confirmed, overdueDays,
      calculation: { graceDays: 3, dailyRate: 0.003, effectiveDays: Math.max(0, overdueDays - 3), baseAmount: base, capped: false, rule: { graceDays: 3, dailyRate: 0.003, fixedDaily: null, cap: 50000 } },
      notes: confirmed ? '已与租客确认，随本月租金一起收取' : null,
      confirmedAt: confirmed ? new Date(TODAY.getTime() - randInt(1, 5) * 86400000) : null,
      confirmedBy: confirmed ? admin.id : null,
      settledAmount: settled,
      settledAt: settled !== null ? new Date(TODAY.getTime() - randInt(1, 3) * 86400000) : null,
    });
  }
  if (lateFees.length) await prisma.lateFee.createMany({ data: lateFees });
  console.log('✅ 滞纳金：' + lateFees.length + ' 条（逾期账单 ' + overdueBills.length + ' 张）');

  // 8. 水电表 + 读数 + 预付账户
  const meters = [];
  for (const r of rooms) {
    const roomId = roomIdOf(r);
    meters.push({ roomId, meterNumber: 'E' + r.buildingId.slice(-1).toUpperCase() + String(r.floor) + String(r.roomNumber).padStart(4, '0'), meterType: 'ELECTRICITY', buildingId: r.buildingId, unitPrice: 62 });
    meters.push({ roomId, meterNumber: 'W' + r.buildingId.slice(-1).toUpperCase() + String(r.floor) + String(r.roomNumber).padStart(4, '0'), meterType: 'WATER', buildingId: r.buildingId, unitPrice: 350 });
  }
  await prisma.meter.createMany({
    data: meters.map((m) => ({
      buildingId: m.buildingId, roomId: m.roomId, meterType: m.meterType, meterNumber: m.meterNumber,
      unitPrice: m.unitPrice, priceEffectiveDate: dateOnly(CUR_Y, CUR_M - 6, 1),
    })),
  });
  for (const pa of publicAreas) {
    await prisma.meter.createMany({
      data: [
        { buildingId: pa.buildingId, publicAreaId: pa.id, meterType: 'ELECTRICITY', meterNumber: 'PE' + pa.id.slice(-6).toUpperCase(), unitPrice: 62, priceEffectiveDate: dateOnly(CUR_Y, CUR_M - 6, 1) },
        { buildingId: pa.buildingId, publicAreaId: pa.id, meterType: 'WATER', meterNumber: 'PW' + pa.id.slice(-6).toUpperCase(), unitPrice: 350, priceEffectiveDate: dateOnly(CUR_Y, CUR_M - 6, 1) },
      ],
    });
  }
  const dbMeters = await prisma.meter.findMany({ where: { roomId: { not: null } }, select: { id: true, roomId: true, meterType: true, unitPrice: true } });
  const meterByRoom = new Map();
  for (const m of dbMeters) {
    if (!meterByRoom.has(m.roomId)) meterByRoom.set(m.roomId, {});
    meterByRoom.get(m.roomId)[m.meterType] = m;
  }
  console.log('✅ 水电表：' + (dbMeters.length + publicAreas.length * 2) + ' 只');

  // 预付账户（在租房间）
  const prepayRows = [];
  for (const r of occupied) {
    const t = tenantRows.find((x) => x.roomIdx === r.idx);
    prepayRows.push({ tenantId: tenantIdOf(t.phone), roomId: roomIdOf(r), balanceCache: randInt(2, 9) === 2 ? randInt(1800, 9000) : randInt(32000, 168000), lowBalanceThreshold: 10000 });
  }
  await prisma.prepayAccount.createMany({ data: prepayRows });
  const dbAccounts = await prisma.prepayAccount.findMany({ select: { id: true, tenantId: true, roomId: true, balanceCache: true } });
  const accountByRoom = new Map(dbAccounts.map((a) => [a.roomId, a]));
  console.log('✅ 预付账户：' + dbAccounts.length + ' 个');

  // 读数 + 扣费流水（近 3 个月）
  const readingRows = [];
  const txRows = [];
  for (const [roomId, pair] of meterByRoom) {
    const account = accountByRoom.get(roomId);
    if (!account) continue;
    let balance = 0;
    // 充值时点
    for (let off = 4; off >= 0; off--) {
      if (off % 2 === 0) {
        const amt = yuan(pick([300, 500, 500, 800, 1000]));
        balance += amt;
        txRows.push({ accountId: account.id, type: 'RECHARGE', amount: amt, balanceAfter: balance, description: monthKey(CUR_Y, CUR_M - off) + ' 预存水电费', operatorId: admin.id, createdAt: new Date(monthStart(-off).getTime() + 3 * 86400000 + 10 * 3600000) });
      }
      for (const type of ['ELECTRICITY', 'WATER']) {
        const meter = pair[type];
        if (!meter) continue;
        const prev = type === 'ELECTRICITY' ? randInt(800, 2400) : randInt(60, 240);
        const usage = type === 'ELECTRICITY' ? randInt(80, 320) : randInt(3, 14);
        const cur = prev + usage;
        const readingTime = new Date(monthStart(-off).getTime() + (off === 0 ? 9 : 27) * 86400000 + 11 * 3600000);
        if (readingTime > TODAY) continue;
        readingRows.push({ meterId: meter.id, currentReading: cur, previousReading: prev, usage, source: 'MANUAL', readingTime, readBy: admin.id, notes: null });
        const cost = Math.round(usage * meter.unitPrice);
        balance -= cost;
        txRows.push({ accountId: account.id, type: 'DEDUCTION', amount: -cost, balanceAfter: balance, description: (type === 'ELECTRICITY' ? '电费' : '水费') + '扣费 · ' + usage + (type === 'ELECTRICITY' ? ' kWh' : ' 吨'), relatedType: 'METER_READING', operatorId: admin.id, createdAt: new Date(readingTime.getTime() + 36e5) });
      }
    }
    account.finalBalance = balance;
  }
  await prisma.meterReading.createMany({ data: readingRows });
  await prisma.prepayTransaction.createMany({ data: txRows.map(({ relatedType, ...rest }) => ({ ...rest, relatedType: relatedType ?? null })) });
  // 让账户余额与流水终点一致
  for (const a of dbAccounts) {
    if (typeof a.finalBalance === 'number' && a.finalBalance !== 0) {
      await prisma.prepayAccount.update({ where: { id: a.id }, data: { balanceCache: Math.max(1200, a.finalBalance) } });
    }
  }
  console.log('✅ 读数：' + readingRows.length + ' 条 · 预付流水：' + txRows.length + ' 条');

  // 9. 报修工单
  const STATUS_PLAN = ['SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'ACKNOWLEDGED', 'ASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'IN_PROGRESS', 'PENDING_CONFIRM', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'CANCELLED'];
  const maintenanceData = [];
  MAINTENANCE_TEMPLATES.forEach((tpl, i) => {
    const r = occupied[(i * 5 + 3) % occupied.length];
    const tenant = tenantRows.find((x) => x.roomIdx === r.idx);
    const status = STATUS_PLAN[i];
    const created = new Date(TODAY.getTime() - (i * 2 + 1) * 86400000 - randInt(0, 20) * 36e5);
    const resolved = ['COMPLETED', 'PENDING_CONFIRM'].includes(status) ? new Date(created.getTime() + (i % 3 + 1) * 86400000) : null;
    maintenanceData.push({
      roomId: roomIdOf(r), tenantId: tenantIdOf(tenant.phone),
      title: tpl.title, description: tpl.desc, category: tpl.category, priority: tpl.priority, status,
      assignedTo: ['ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRM', 'COMPLETED'].includes(status) ? '维修组 · 王师傅' : null,
      assignedAt: ['ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRM', 'COMPLETED'].includes(status) ? new Date(created.getTime() + 36e5) : null,
      resolvedAt: resolved,
      resolution: status === 'COMPLETED' ? '已上门处理并测试正常，与租客确认无误。' : null,
      createdAt: created,
    });
  });
  for (const m of maintenanceData) await prisma.maintenanceRequest.create({ data: m });
  console.log('✅ 报修工单：' + maintenanceData.length + ' 条');

  // 10. 退租结算
  const terminated = dbContracts.filter((c) => c.status === 'TERMINATED').slice(0, 3);
  const checkoutPlan = [
    { status: 'COMPLETED', items: [
      { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 3200 },
      { itemType: 'DEPOSIT_DEDUCTION', description: '墙面补漆与清洁费', amount: -380 },
      { itemType: 'UTILITY_REFUND', description: '水电余额退还', amount: 126.5 },
    ] },
    { status: 'COMPLETED', items: [
      { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 1800 },
      { itemType: 'RENT_REFUND', description: '多收租金退还（按实际居住天数折算）', amount: 420 },
      { itemType: 'DEPOSIT_DEDUCTION', description: '门锁更换', amount: -260 },
    ] },
    { status: 'PENDING', items: [
      { itemType: 'DEPOSIT_REFUND', description: '押金退还', amount: 4500 },
      { itemType: 'OTHER_FEE', description: '逾期未缴水电费', amount: -312.8 },
    ] },
  ];
  for (let i = 0; i < terminated.length && i < checkoutPlan.length; i++) {
    const c = terminated[i];
    const plan = checkoutPlan[i];
    const total = plan.items.reduce((s, x) => s + yuan(x.amount), 0);
    const checkoutDate = new Date(c.endDate);
    await prisma.checkoutRecord.create({
      data: {
        contractId: c.id, roomId: c.roomId, checkoutDate, totalRefund: total, status: plan.status,
        notes: i === 0 ? '租客已搬离，钥匙与门禁卡已交回。' : null,
        processedBy: admin.id,
        processedAt: plan.status === 'COMPLETED' ? new Date(checkoutDate.getTime() + 2 * 86400000) : null,
        items: { create: plan.items.map((it) => ({ itemType: it.itemType, description: it.description, amount: yuan(it.amount), isAdjusted: it.itemType === 'DEPOSIT_DEDUCTION', adjustReason: it.itemType === 'DEPOSIT_DEDUCTION' ? '现场验收确认' : null })) },
      },
    });
  }
  console.log('✅ 退租结算：' + Math.min(terminated.length, checkoutPlan.length) + ' 单');

  // 11. 通知 + 审计日志
  await prisma.notification.createMany({
    data: [
      { userId: admin.id, title: '本月账单已生成', body: '2026-10 月度租金账单已生成，共 61 张，请及时跟进收款。', priority: 'NORMAL', isRead: false, data: { period: '2026-10' }, createdAt: new Date(TODAY.getTime() - 3 * 86400000) },
      { userId: admin.id, title: '有 6 张账单进入逾期', body: '以下账单已超过应缴日期，系统已按合同规则计算建议滞纳金，请确认后跟进。', priority: 'URGENT', isRead: false, data: { count: 6 }, createdAt: new Date(TODAY.getTime() - 2 * 86400000) },
      { userId: admin.id, title: '新的报修工单', body: 'B 座 302 提交「热水器打不着火」，优先级：紧急。', priority: 'URGENT', isRead: true, readAt: new Date(TODAY.getTime() - 86400000), data: { category: 'APPLIANCE' }, createdAt: new Date(TODAY.getTime() - 5 * 86400000) },
      { userId: admin.id, title: '预付账户余额不足提醒', body: '3 个预付账户余额已低于提醒阈值，建议通知租客充值。', priority: 'NORMAL', isRead: true, readAt: new Date(TODAY.getTime() - 2 * 86400000), data: { count: 3 }, createdAt: new Date(TODAY.getTime() - 6 * 86400000) },
      { userId: admin.id, title: '退租结算待确认', body: 'A 座 204 的退租结算单已提交，等待确认退款。', priority: 'NORMAL', isRead: false, data: { status: 'PENDING' }, createdAt: new Date(TODAY.getTime() - 86400000) },
    ],
  });
  const auditActions = [
    ['CREATE', 'Room'], ['CREATE', 'Contract'], ['UPDATE', 'Room'], ['CREATE', 'Bill'],
    ['CREATE', 'PaymentRecord'], ['UPDATE', 'Contract'], ['CREATE', 'PrepayTransaction'],
    ['UPDATE', 'MaintenanceRequest'], ['CREATE', 'CheckoutRecord'], ['UPDATE', 'Bill'],
    ['CREATE', 'MeterReading'], ['UPDATE', 'MaintenanceRequest'],
  ];
  await prisma.auditLog.createMany({
    data: auditActions.map(([action, entityType], i) => ({
      userId: admin.id, action, entityType,
      entityId: dbRooms[i % dbRooms.length].id,
      changes: action === 'CREATE' ? { after: { note: '演示数据' } } : { before: { status: 'PENDING' }, after: { status: 'PAID' } },
      ip: '10.20.31.' + (10 + i), userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
      createdAt: new Date(TODAY.getTime() - i * 5 * 36e5),
    })),
  });
  console.log('✅ 通知 5 条 · 审计日志 ' + auditActions.length + ' 条');

  // 12. 收尾：房态与合同对齐
  await prisma.room.updateMany({ where: { status: 'RESERVED' }, data: { cleanStatus: 'CLEAN' } });

  const summary = {
    buildings: await prisma.building.count(), rooms: await prisma.room.count(),
    tenants: await prisma.tenant.count(), contracts: await prisma.contract.count(),
    bills: await prisma.bill.count(), payments: await prisma.paymentRecord.count(),
    meters: await prisma.meter.count(), readings: await prisma.meterReading.count(),
    prepay: await prisma.prepayAccount.count(), transactions: await prisma.prepayTransaction.count(),
    maintenance: await prisma.maintenanceRequest.count(), notifications: await prisma.notification.count(),
  };
  console.log('\n📊 汇总：', JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => { console.error('❌ 种子失败：', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
