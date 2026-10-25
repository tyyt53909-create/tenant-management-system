import { INestApplication, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { EmailOtpService } from '../../src/modules/auth/email-otp.service.js';
import {
  UnsafeIntegrationTargetError,
  assertIntegrationEnvironment,
  resetMarkedIntegrationDatabase,
} from './guard.js';

/**
 * QLT-01 / T255，清空保护见 T316 / R01。
 *
 * 约定：
 * - 只连接 `INTEGRATION_DATABASE_URL`。缺少时失败，不回退到 `DATABASE_URL`；
 * - `resetDatabase()` 在标记、非超级用户和破坏性开关都通过之后才 TRUNCATE；
 * - 通过真实 HTTP + 真实 Prisma 验证，不使用 Prisma mock。
 */

const integrationTarget = assertIntegrationEnvironment(process.env);
export const prisma = new PrismaClient({
  datasources: { db: { url: integrationTarget.databaseUrl } },
});

export interface SeedBase {
  buildingId: string;
  adminId: string;
  adminEmail: string;
  cleanerId: string;
  cleanerEmail: string;
  adminPassword: string;
  cleanerPassword: string;
}

export const ADMIN_PASSWORD = 'Integration@123';
export const CLEANER_PASSWORD = 'Cleaner@123';

export async function resetDatabase(): Promise<void> {
  await resetMarkedIntegrationDatabase(process.env, {
    readMarker: () =>
      prisma.$queryRawUnsafe<Array<{ token: string; rolsuper: boolean }>>(
        `SELECT m.token, r.rolsuper
         FROM integration_guard.marker m
         CROSS JOIN pg_roles r
         WHERE m.id = 1 AND r.rolname = current_user`,
      ),
    listPublicTables: async () => {
      const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      `;
      return tables.map((table) => table.tablename);
    },
    truncate: (sql) => prisma.$executeRawUnsafe(sql).then(() => undefined),
  });
}

export async function seedBase(): Promise<SeedBase> {
  const building = await prisma.building.create({
    data: {
      name: '集成测试楼栋',
      floors: 3,
      metadata: { landlordName: '测试业主', landlordPhone: '13800138000' },
    },
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  const admin = await prisma.user.create({
    data: {
      email: 'integration-admin@example.com',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
  const cleaner = await prisma.user.create({
    data: {
      email: 'integration-cleaner@example.com',
      passwordHash: await bcrypt.hash(CLEANER_PASSWORD, 4),
      role: 'CLEANER',
      isActive: true,
    },
  });

  return {
    buildingId: building.id,
    adminId: admin.id,
    adminEmail: admin.email!,
    cleanerId: cleaner.id,
    cleanerEmail: cleaner.email!,
    adminPassword: ADMIN_PASSWORD,
    cleanerPassword: CLEANER_PASSWORD,
  };
}

export async function createApp(): Promise<INestApplication> {
  const target = assertIntegrationEnvironment(process.env);
  if (process.env.DATABASE_URL !== target.databaseUrl) {
    throw new UnsafeIntegrationTargetError(
      '应用 DATABASE_URL 与 INTEGRATION_DATABASE_URL 不一致，拒绝启动。不会回退到开发库',
    );
  }
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

export function http(app: INestApplication) {
  return request(app.getHttpServer());
}

export async function login(
  app: INestApplication,
  identifier: string,
  password: string,
): Promise<string> {
  const response = await http(app).post('/auth/login').send({ identifier, password });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`登录失败 ${identifier}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.accessToken as string;
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export interface Tenancy {
  roomId: string;
  tenantId: string;
  contractId: string;
  tenantToken: string;
  adminToken: string;
}

let tenancySeq = 0;

/** J1 的最小前置：预建租客 → 邀请码注册 → 房源 RESERVED → 合同 ACTIVE。 */
export async function setupTenancy(app: INestApplication, base: SeedBase): Promise<Tenancy> {
  const seq = ++tenancySeq;
  const adminToken = await login(app, base.adminEmail, base.adminPassword);

  const roomResponse = await http(app)
    .post('/rooms')
    .set(auth(adminToken))
    .send({ buildingId: base.buildingId, roomNumber: `IT-${Date.now()}-${seq}`, floor: 1, roomType: 'SINGLE', area: 25 });
  if (roomResponse.status !== 201) {
    throw new Error(`创建房源失败: ${roomResponse.status} ${JSON.stringify(roomResponse.body)}`);
  }
  const roomId = roomResponse.body.id as string;

  const phone = `139${String(Date.now() + seq).slice(-8)}`;
  const tenantEmail = `tenant-${Date.now()}-${seq}@example.com`;
  const tenantResponse = await http(app)
    .post('/tenants')
    .set(auth(adminToken))
    .send({ name: '集成测试租客', phone, email: tenantEmail });
  if (tenantResponse.status !== 201) {
    throw new Error(`创建租客失败: ${tenantResponse.status} ${JSON.stringify(tenantResponse.body)}`);
  }
  const tenantId = tenantResponse.body.id as string;

  const inviteResponse = await http(app)
    .post('/auth/invite-codes')
    .set(auth(adminToken))
    .send({ expiryDays: 1, role: 'TENANT', tenantId });
  const inviteCode = (inviteResponse.body.inviteCode ?? inviteResponse.body.code) as string;
  if (!inviteCode) {
    throw new Error(`生成邀请码失败: ${JSON.stringify(inviteResponse.body)}`);
  }

  const emailCode = '654321';
  await app.get(EmailOtpService).seedCodeForTests(tenantEmail, emailCode);
  const registerResponse = await http(app)
    .post('/auth/register')
    .send({ email: tenantEmail, password: 'Tenant@123', inviteCode, emailCode });
  if (registerResponse.status !== 201 && registerResponse.status !== 200) {
    throw new Error(`注册失败: ${registerResponse.status} ${JSON.stringify(registerResponse.body)}`);
  }
  const tenantToken = registerResponse.body.accessToken as string;

  const start = new Date();
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  const contractResponse = await http(app)
    .post('/contracts')
    .set(auth(adminToken))
    .send({
      buildingId: base.buildingId,
      roomId,
      tenantId,
      rentAmount: 300000,
      depositAmount: 300000,
      paymentCycle: 'MONTHLY',
      paymentDay: 1,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    });
  if (contractResponse.status !== 201) {
    throw new Error(`创建合同失败: ${contractResponse.status} ${JSON.stringify(contractResponse.body)}`);
  }
  const contractId = contractResponse.body.id as string;

  // 房态状态机要求：先有 DRAFT 合同，才能把 VACANT 置为 RESERVED
  const reserve = await http(app)
    .patch(`/rooms/${roomId}`)
    .set(auth(adminToken))
    .send({ status: 'RESERVED' });
  if (reserve.status !== 200) {
    throw new Error(`房源置 RESERVED 失败: ${reserve.status} ${JSON.stringify(reserve.body)}`);
  }

  const activate = await http(app)
    .patch(`/contracts/${contractId}`)
    .set(auth(adminToken))
    .send({ status: 'ACTIVE' });
  if (activate.status !== 200) {
    throw new Error(`合同生效失败: ${activate.status} ${JSON.stringify(activate.body)}`);
  }

  return { roomId, tenantId, contractId, tenantToken, adminToken };
}
