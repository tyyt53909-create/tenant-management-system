import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  UnsafeIntegrationTargetError,
  assertIntegrationEnvironment,
  assertMarkedIntegrationDatabase,
  resetMarkedIntegrationDatabase,
  type ResetProbe,
} from './guard.js';

const MARKER = 'ci-integration-marker-t316';

function safeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    ALLOW_INTEGRATION_RESET: 'true',
    INTEGRATION_DATABASE_URL: 'postgresql://integration_tester:secret@127.0.0.1:5432/test_db',
    INTEGRATION_DATABASE_MARKER: MARKER,
    INTEGRATION_REDIS_URL: 'redis://127.0.0.1:6379/1',
    DATABASE_URL: 'postgresql://tenant_user:secret@127.0.0.1:5432/tenant_system',
    ...overrides,
  };
}

function probe(overrides: Partial<ResetProbe> = {}): ResetProbe {
  return {
    readMarker: vi.fn(async () => [{ token: MARKER, rolsuper: false }]),
    listPublicTables: vi.fn(async () => ['bills']),
    truncate: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('整合测试清空保护', () => {
  it('缺少破坏性开关时拒绝，且不查询、不清空', async () => {
    const target = probe();
    await expect(
      resetMarkedIntegrationDatabase(safeEnv({ ALLOW_INTEGRATION_RESET: undefined }), target),
    ).rejects.toBeInstanceOf(UnsafeIntegrationTargetError);
    expect(target.readMarker).not.toHaveBeenCalled();
    expect(target.listPublicTables).not.toHaveBeenCalled();
    expect(target.truncate).not.toHaveBeenCalled();
  });

  it('只有 DATABASE_URL 时不回退', () => {
    expect(() =>
      assertIntegrationEnvironment(
        safeEnv({
          INTEGRATION_DATABASE_URL: undefined,
          DATABASE_URL: 'postgresql://tenant_user:secret@127.0.0.1:5432/test_db',
        }),
      ),
    ).toThrow(/不会回退到 DATABASE_URL/);
  });

  it('库名包含 test 但没有标记时，在 TRUNCATE 前拒绝', async () => {
    const target = probe({
      readMarker: vi.fn(async () => {
        throw new Error('relation "integration_guard.marker" does not exist');
      }),
    });
    await expect(resetMarkedIntegrationDatabase(safeEnv(), target)).rejects.toThrow(/TRUNCATE 前拒绝/);
    expect(target.truncate).not.toHaveBeenCalled();
    expect(target.listPublicTables).not.toHaveBeenCalled();
  });

  it('标记不一致或账号是超级用户时拒绝清空', async () => {
    const mismatch = probe({ readMarker: vi.fn(async () => [{ token: 'other-marker-value!!', rolsuper: false }]) });
    await expect(resetMarkedIntegrationDatabase(safeEnv(), mismatch)).rejects.toThrow(/标记/);
    expect(mismatch.truncate).not.toHaveBeenCalled();

    const superuser = probe({ readMarker: vi.fn(async () => [{ token: MARKER, rolsuper: true }]) });
    await expect(resetMarkedIntegrationDatabase(safeEnv(), superuser)).rejects.toThrow(/超级用户/);
    expect(superuser.truncate).not.toHaveBeenCalled();
  });

  it('拒绝开发库名、db 0，以及非 test 环境', () => {
    expect(() =>
      assertIntegrationEnvironment(
        safeEnv({
          INTEGRATION_DATABASE_URL: 'postgresql://integration_tester:secret@127.0.0.1:5432/tenant_system',
        }),
      ),
    ).toThrow(/tenant_system/);
    expect(() =>
      assertIntegrationEnvironment(safeEnv({ INTEGRATION_REDIS_URL: 'redis://127.0.0.1:6379/0' })),
    ).toThrow(/db 0/);
    expect(() => assertIntegrationEnvironment(safeEnv({ NODE_ENV: 'development' }))).toThrow(/NODE_ENV=test/);
  });

  it('正式夹具条件满足后才清空，且不碰迁移表', async () => {
    const target = probe({
      listPublicTables: vi.fn(async () => ['_prisma_migrations', 'bills', 'rooms']),
    });
    await resetMarkedIntegrationDatabase(safeEnv(), target);
    expect(target.truncate).toHaveBeenCalledWith(
      'TRUNCATE TABLE "bills", "rooms" RESTART IDENTITY CASCADE',
    );
  });

  it('准备脚本的可执行语句不包含清空或删除', () => {
    const script = readFileSync(new URL('../../scripts/prepare-integration-db.sh', import.meta.url), 'utf8');
    const executable = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(executable).not.toMatch(/\bTRUNCATE\b/i);
    expect(executable).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(executable).not.toMatch(/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i);
    expect(script).toContain('不会回退到 DATABASE_URL');
  });
});

describe('标记读取失败', () => {
  it('空标记行也拒绝', async () => {
    await expect(
      assertMarkedIntegrationDatabase({ readMarker: async () => [] }, MARKER),
    ).rejects.toThrow(/TRUNCATE 前拒绝/);
  });
});
