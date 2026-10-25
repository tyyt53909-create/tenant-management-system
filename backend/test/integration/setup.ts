import { PrismaClient } from '@prisma/client';
import {
  applyIntegrationProcessEnv,
  assertIntegrationEnvironment,
  assertMarkedIntegrationDatabase,
} from './guard.js';

/**
 * 在导入测试和构造应用前执行。失败即停止，不把 DATABASE_URL 改写成测试库，
 * 也不回退到开发库。
 */
const target = assertIntegrationEnvironment(process.env);
const probe = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });

try {
  await assertMarkedIntegrationDatabase(
    {
      readMarker: async () =>
        probe.$queryRawUnsafe<Array<{ token: string; rolsuper: boolean }>>(
          `SELECT m.token, r.rolsuper
           FROM integration_guard.marker m
           CROSS JOIN pg_roles r
           WHERE m.id = 1 AND r.rolname = current_user`,
        ),
    },
    target.marker,
  );
} finally {
  await probe.$disconnect();
}

applyIntegrationProcessEnv(target, process.env);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-min-32-bytes-long!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'ci-test-encryption-key-32-bytes!';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000';
