import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  SEED_DEFAULTS,
  PRODUCTION_MIN_PASSWORD_LENGTH,
  assertProductionSeedSafety,
  runSeed,
} from './seed.js';

/** 最小化 Prisma 桩：只实现种子脚本用到的写入方法 */
function createPrismaStub() {
  return {
    building: { upsert: vi.fn().mockResolvedValue({ id: SEED_DEFAULTS.BUILDING_ID, name: '默认楼栋' }) },
    user: {
      upsert: vi.fn().mockResolvedValue({ id: 'user-admin' }),
      update: vi.fn().mockResolvedValue({ id: 'user-admin' }),
    },
  };
}

function deps(stub: ReturnType<typeof createPrismaStub>, env: Record<string, string | undefined>) {
  return {
    prisma: stub as unknown as PrismaClient,
    env,
    log: () => {},
  };
}

describe('seed 生产守卫（T148）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('assertProductionSeedSafety', () => {
    it('NODE_ENV=production 且缺少显式账号环境变量 → 抛错，列出缺失变量', () => {
      expect(() => assertProductionSeedSafety({ NODE_ENV: 'production' })).toThrow(
        /生产环境拒绝执行种子脚本/,
      );
      expect(() => assertProductionSeedSafety({ NODE_ENV: 'production' })).toThrow(/ADMIN_EMAIL/);
      expect(() => assertProductionSeedSafety({ NODE_ENV: 'production' })).toThrow(
        /CLEANER_PASSWORD/,
      );
    });

    it('NODE_ENV=production 且使用默认邮箱/默认密码 → 抛错', () => {
      const env = {
        NODE_ENV: 'production',
        ADMIN_EMAIL: SEED_DEFAULTS.ADMIN_EMAIL,
        ADMIN_PASSWORD: SEED_DEFAULTS.ADMIN_PASSWORD,
        CLEANER_EMAIL: SEED_DEFAULTS.CLEANER_EMAIL,
        CLEANER_PASSWORD: SEED_DEFAULTS.CLEANER_PASSWORD,
      };

      expect(() => assertProductionSeedSafety(env)).toThrow(/默认邮箱/);
      expect(() => assertProductionSeedSafety(env)).toThrow(/默认密码/);
    });

    it('NODE_ENV=production 且密码短于最小长度 → 抛错', () => {
      const env = {
        NODE_ENV: 'production',
        ADMIN_EMAIL: 'owner@real-company.com',
        ADMIN_PASSWORD: 'short',
        CLEANER_EMAIL: 'cleaner@real-company.com',
        CLEANER_PASSWORD: 'x'.repeat(PRODUCTION_MIN_PASSWORD_LENGTH - 1),
      };

      expect(() => assertProductionSeedSafety(env)).toThrow(/ADMIN_PASSWORD 长度至少/);
      expect(() => assertProductionSeedSafety(env)).toThrow(/CLEANER_PASSWORD 长度至少/);
    });

    it('NODE_ENV=production 且显式提供强账号 → 通过', () => {
      const env = {
        NODE_ENV: 'production',
        ADMIN_EMAIL: 'owner@real-company.com',
        ADMIN_PASSWORD: 'A-very-strong-admin-passphrase',
        CLEANER_EMAIL: 'cleaner@real-company.com',
        CLEANER_PASSWORD: 'A-very-strong-cleaner-passphrase',
      };

      expect(() => assertProductionSeedSafety(env)).not.toThrow();
    });

    it('非生产环境（未设置或 development）→ 不限制', () => {
      expect(() => assertProductionSeedSafety({})).not.toThrow();
      expect(() => assertProductionSeedSafety({ NODE_ENV: 'development' })).not.toThrow();
      expect(() => assertProductionSeedSafety({ NODE_ENV: 'test' })).not.toThrow();
    });
  });

  describe('runSeed', () => {
    it('生产环境使用默认账号 → 在写库前抛错，不产生任何 upsert', async () => {
      const stub = createPrismaStub();

      await expect(
        runSeed(deps(stub, { NODE_ENV: 'production', ADMIN_EMAIL: SEED_DEFAULTS.ADMIN_EMAIL })),
      ).rejects.toThrow(/生产环境拒绝执行种子脚本/);

      expect(stub.building.upsert).not.toHaveBeenCalled();
      expect(stub.user.upsert).not.toHaveBeenCalled();
      expect(stub.user.update).not.toHaveBeenCalled();
    });

    it('生产环境使用显式强凭据 → 只使用环境变量中的账号，不创建默认账号', async () => {
      const stub = createPrismaStub();
      const env = {
        NODE_ENV: 'production',
        ADMIN_EMAIL: 'owner@real-company.com',
        ADMIN_PASSWORD: 'A-very-strong-admin-passphrase',
        CLEANER_EMAIL: 'cleaner@real-company.com',
        CLEANER_PASSWORD: 'A-very-strong-cleaner-passphrase',
      };

      const result = await runSeed(deps(stub, env));

      expect(result.adminEmail).toBe('owner@real-company.com');
      expect(result.cleanerEmail).toBe('cleaner@real-company.com');

      const createdEmails = stub.user.upsert.mock.calls.map((call: any[]) => call[0].where.email);
      expect(createdEmails).toEqual(['owner@real-company.com', 'cleaner@real-company.com']);
      expect(createdEmails).not.toContain(SEED_DEFAULTS.ADMIN_EMAIL);
      expect(createdEmails).not.toContain(SEED_DEFAULTS.CLEANER_EMAIL);

      // 落库的密码哈希必须对应环境变量中的密码，而不是默认密码
      const adminHash = stub.user.upsert.mock.calls[0][0].create.passwordHash as string;
      await expect(bcrypt.compare(env.ADMIN_PASSWORD, adminHash)).resolves.toBe(true);
      await expect(bcrypt.compare(SEED_DEFAULTS.ADMIN_PASSWORD, adminHash)).resolves.toBe(false);
    });

    it('开发环境（NODE_ENV 未设置）→ 沿用默认账号，便于本地开发', async () => {
      const stub = createPrismaStub();

      const result = await runSeed(deps(stub, {}));

      expect(result.adminEmail).toBe(SEED_DEFAULTS.ADMIN_EMAIL);
      expect(result.cleanerEmail).toBe(SEED_DEFAULTS.CLEANER_EMAIL);
      expect(stub.building.upsert).toHaveBeenCalledTimes(1);
      expect(stub.user.upsert).toHaveBeenCalledTimes(2);
      expect(stub.user.update).toHaveBeenCalledTimes(1);
      // 邀请码仍需落到管理员账号
      expect(stub.user.update.mock.calls[0][0].data.inviteCode).toMatch(/^INVITE-/);
    });
  });
});
