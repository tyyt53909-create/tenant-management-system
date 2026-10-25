import { timingSafeEqual } from 'node:crypto';
import { parseRedisUrl } from '../../src/config/env.schema.js';

/**
 * 整合测试清空保护（T316 / R01）。
 *
 * 数据库名里有没有 "test" 不算安全。清空前必须同时通过：
 * 1. NODE_ENV=test
 * 2. ALLOW_INTEGRATION_RESET=true
 * 3. 只使用 INTEGRATION_DATABASE_URL，不回退 DATABASE_URL
 * 4. integration_guard.marker 与 INTEGRATION_DATABASE_MARKER 一致
 * 5. 当前账号不是超级用户
 * 6. INTEGRATION_REDIS_URL 使用编号 >= 1 的独立库，不回退 db 0
 */

export class UnsafeIntegrationTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeIntegrationTargetError';
  }
}

export interface IntegrationTarget {
  databaseUrl: string;
  marker: string;
  redisUrl: string;
}

export interface MarkerRoleRow {
  token: string;
  rolsuper: boolean;
}

export interface IntegrationProbe {
  readMarker(): Promise<MarkerRoleRow[]>;
}

const DENIED_DATABASE_NAMES = new Set(['postgres', 'template0', 'template1', 'tenant_system']);

export function assertIntegrationEnvironment(env: NodeJS.ProcessEnv): IntegrationTarget {
  if (env.NODE_ENV !== 'test') {
    throw new UnsafeIntegrationTargetError('整合测试要求 NODE_ENV=test，拒绝继续');
  }
  if (env.ALLOW_INTEGRATION_RESET !== 'true') {
    throw new UnsafeIntegrationTargetError(
      '缺少显式破坏性开关 ALLOW_INTEGRATION_RESET=true，拒绝清空数据库',
    );
  }

  const databaseUrl = env.INTEGRATION_DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) {
    throw new UnsafeIntegrationTargetError(
      '必须设置 INTEGRATION_DATABASE_URL。不会回退到 DATABASE_URL',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new UnsafeIntegrationTargetError('INTEGRATION_DATABASE_URL 不是合法 URL');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new UnsafeIntegrationTargetError('INTEGRATION_DATABASE_URL 必须是 postgres URL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0] ?? '';
  if (!databaseName || DENIED_DATABASE_NAMES.has(databaseName)) {
    throw new UnsafeIntegrationTargetError(
      `拒绝连接数据库 ${databaseName || '(空)'}。库名包含 test 也不能代替标记检查`,
    );
  }

  const marker = env.INTEGRATION_DATABASE_MARKER?.trim() ?? '';
  if (marker.length < 16) {
    throw new UnsafeIntegrationTargetError(
      'INTEGRATION_DATABASE_MARKER 至少 16 个字符，且必须与库内标记一致',
    );
  }

  const redisUrl = env.INTEGRATION_REDIS_URL?.trim() ?? '';
  if (!redisUrl) {
    throw new UnsafeIntegrationTargetError(
      '必须设置 INTEGRATION_REDIS_URL。不会回退到 REDIS_HOST 或 db 0',
    );
  }
  const redis = parseRedisUrl(redisUrl);
  if (typeof redis === 'string') {
    throw new UnsafeIntegrationTargetError(`INTEGRATION_REDIS_URL 不合法：${redis}`);
  }
  if (redis.db < 1) {
    throw new UnsafeIntegrationTargetError(
      'INTEGRATION_REDIS_URL 必须使用独立 Redis db（编号 >= 1），拒绝 db 0',
    );
  }

  return { databaseUrl, marker, redisUrl };
}

export function tokensMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 只读检查。失败时不得继续执行 TRUNCATE。 */
export async function assertMarkedIntegrationDatabase(
  probe: IntegrationProbe,
  marker: string,
): Promise<void> {
  let rows: MarkerRoleRow[];
  try {
    rows = await probe.readMarker();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UnsafeIntegrationTargetError(
      `整合测试库未标记或无法读取标记，已在 TRUNCATE 前拒绝：${detail}`,
    );
  }

  const row = rows[0];
  if (rows.length !== 1 || row === undefined || !tokensMatch(row.token, marker)) {
    throw new UnsafeIntegrationTargetError(
      '数据库标记与 INTEGRATION_DATABASE_MARKER 不一致，已在 TRUNCATE 前拒绝',
    );
  }
  if (row.rolsuper) {
    throw new UnsafeIntegrationTargetError('整合测试账号不能是超级用户，已在 TRUNCATE 前拒绝');
  }
}

export function quoteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new UnsafeIntegrationTargetError(`拒绝清空非法表名：${name}`);
  }
  return `"${name}"`;
}

export interface ResetProbe extends IntegrationProbe {
  listPublicTables(): Promise<string[]>;
  truncate(sql: string): Promise<void>;
}

/**
 * 环境或标记失败时，listPublicTables 与 truncate 都不得被调用。
 * 表清单查询发生在标记通过之后、TRUNCATE 之前。
 */
export async function resetMarkedIntegrationDatabase(
  env: NodeJS.ProcessEnv,
  probe: ResetProbe,
): Promise<void> {
  const target = assertIntegrationEnvironment(env);
  await assertMarkedIntegrationDatabase(probe, target.marker);
  const tables = (await probe.listPublicTables()).filter((name) => name !== '_prisma_migrations');
  if (tables.length === 0) return;
  const list = tables.map(quoteIdentifier).join(', ');
  await probe.truncate(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** 只在标记检查通过后调用，让应用和夹具指向同一测试库与 Redis namespace。 */
export function applyIntegrationProcessEnv(target: IntegrationTarget, env: NodeJS.ProcessEnv): void {
  env.DATABASE_URL = target.databaseUrl;
  env.REDIS_URL = target.redisUrl;
  const redis = parseRedisUrl(target.redisUrl);
  if (typeof redis !== 'string') env.REDIS_DB = String(redis.db);
}
