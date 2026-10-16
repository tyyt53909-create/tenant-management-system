import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// 获取当前文件目录（ES 模块）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 仓库内置的默认种子数据（仅限开发/测试环境使用，生产环境禁止） */
export const SEED_DEFAULTS = {
  BUILDING_ID: 'building-001',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'Admin@123',
  CLEANER_EMAIL: 'cleaner@example.com',
  CLEANER_PASSWORD: 'Cleaner@123',
} as const;

/** 生产环境密码最小长度 */
export const PRODUCTION_MIN_PASSWORD_LENGTH = 12;

export type SeedEnv = Record<string, string | undefined>;

/**
 * 生产环境种子守卫（T148）
 *
 * NODE_ENV=production 时必须显式提供 ADMIN_/CLEANER_ 账号环境变量，
 * 且不得使用仓库内置的默认邮箱/默认密码，否则在写库前抛错退出（CLI 退出码 1）。
 * 开发/测试环境（NODE_ENV !== 'production'）保持原有默认账号行为。
 */
export function assertProductionSeedSafety(env: SeedEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const issues: string[] = [];

  const requiredVariables = ['ADMIN_EMAIL', 'ADMIN_PASSWORD', 'CLEANER_EMAIL', 'CLEANER_PASSWORD'];
  for (const name of requiredVariables) {
    const value = env[name];
    if (!value || !value.trim()) {
      issues.push(`缺少显式环境变量 ${name}`);
    }
  }

  if (env.ADMIN_EMAIL?.trim().toLowerCase() === SEED_DEFAULTS.ADMIN_EMAIL) {
    issues.push(`ADMIN_EMAIL 不允许使用默认邮箱 ${SEED_DEFAULTS.ADMIN_EMAIL}`);
  }
  if (env.CLEANER_EMAIL?.trim().toLowerCase() === SEED_DEFAULTS.CLEANER_EMAIL) {
    issues.push(`CLEANER_EMAIL 不允许使用默认邮箱 ${SEED_DEFAULTS.CLEANER_EMAIL}`);
  }
  if (env.ADMIN_PASSWORD === SEED_DEFAULTS.ADMIN_PASSWORD) {
    issues.push('ADMIN_PASSWORD 不允许使用默认密码');
  }
  if (env.CLEANER_PASSWORD === SEED_DEFAULTS.CLEANER_PASSWORD) {
    issues.push('CLEANER_PASSWORD 不允许使用默认密码');
  }
  for (const name of ['ADMIN_PASSWORD', 'CLEANER_PASSWORD']) {
    const value = env[name]?.trim();
    if (value && value.length < PRODUCTION_MIN_PASSWORD_LENGTH) {
      issues.push(`${name} 长度至少 ${PRODUCTION_MIN_PASSWORD_LENGTH} 位`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `生产环境拒绝执行种子脚本（不会创建任何默认账号）：\n - ${issues.join('\n - ')}`,
    );
  }
}

export interface SeedDeps {
  prisma: PrismaClient;
  env?: SeedEnv;
  log?: (message: string) => void;
}

export async function runSeed({ prisma, env = process.env, log = (message: string) => console.log(message) }: SeedDeps) {
  // 生产守卫：不满足条件时在创建任何数据之前抛错
  assertProductionSeedSafety(env);

  log('🌱 开始种子数据初始化...');

  // 1. 创建默认楼栋
  const DEFAULT_BUILDING_ID = env.DEFAULT_BUILDING_ID || SEED_DEFAULTS.BUILDING_ID;

  const building = await prisma.building.upsert({
    where: { id: DEFAULT_BUILDING_ID },
    update: {},
    create: {
      id: DEFAULT_BUILDING_ID,
      name: '默认楼栋',
      floors: 7,
      metadata: {
        landlordName: '陈管家',
        landlordPhone: '13800138000',
        landlordWechat: 'qiju_service',
        serviceHours: '09:00 - 21:00',
        emergencyPhone: '13800138000',
        notice: '紧急设施问题（漏水、断电、门锁等）请优先拨打电话，一般咨询可添加微信留言。',
        description: '系统默认楼栋',
      },
      isActive: true,
    },
  });

  log(`✅ 默认楼栋已创建: ${building.name}`);

  // 2. 创建管理员账号
  const adminEmail = env.ADMIN_EMAIL || SEED_DEFAULTS.ADMIN_EMAIL;
  const adminPassword = env.ADMIN_PASSWORD || SEED_DEFAULTS.ADMIN_PASSWORD;

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  log(`✅ 管理员账号已创建: ${adminEmail}`);

  // 2.1 创建保洁账号（T143：保洁登录小程序使用）
  const cleanerEmail = env.CLEANER_EMAIL || SEED_DEFAULTS.CLEANER_EMAIL;
  const cleanerPassword = env.CLEANER_PASSWORD || SEED_DEFAULTS.CLEANER_PASSWORD;
  const cleanerPasswordHash = await bcrypt.hash(cleanerPassword, 10);

  await prisma.user.upsert({
    where: { email: cleanerEmail },
    update: {},
    create: {
      email: cleanerEmail,
      passwordHash: cleanerPasswordHash,
      role: 'CLEANER',
      isActive: true,
    },
  });

  log(`✅ 保洁账号已创建: ${cleanerEmail}`);

  // 3. 生成测试用邀请码
  const testInviteCode = `INVITE-${Date.now()}`;
  const inviteExpiredAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1年后过期

  await prisma.inviteCode.upsert({
    where: { code: testInviteCode },
    update: {},
    create: {
      code: testInviteCode,
      role: 'TENANT',
      status: 'UNUSED',
      notes: '系统初始测试邀请码',
      creatorId: admin.id,
      expiresAt: inviteExpiredAt,
    },
  });

  log(`✅ 测试邀请码已生成: ${testInviteCode}`);
  log(`   有效期至: ${inviteExpiredAt.toLocaleDateString()}`);

  log('🎉 种子数据初始化完成！');
  log('');
  log('📝 初始化摘要:');
  log(`   - 楼栋ID: ${DEFAULT_BUILDING_ID}`);
  log(`   - 管理员邮箱: ${adminEmail}`);
  log(`   - 保洁邮箱: ${cleanerEmail}`);
  log(`   - 邀请码: ${testInviteCode}`);

  return { buildingId: DEFAULT_BUILDING_ID, adminEmail, cleanerEmail, testInviteCode };
}

/** CLI 入口：加载 .env、建连、执行种子 */
async function runCli(): Promise<void> {
  dotenv.config({ path: resolve(__dirname, '../.env') });
  const prisma = new PrismaClient();
  try {
    await runSeed({ prisma });
  } finally {
    await prisma.$disconnect();
  }
}

/** 仅在被直接执行（ts-node prisma/seed.ts / prisma db seed）时运行，避免被测试导入时触发副作用 */
const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === __filename;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runCli().catch((e) => {
    console.error('❌ 种子数据初始化失败:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
