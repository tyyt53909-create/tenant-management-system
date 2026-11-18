import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupFileName, expiredBackups, parseBackupDate, safeDbName, sameDatabaseTarget } from './backup-core.mjs';

test('备份文件名含 UTC 时间戳，数据库名被清洗', () => {
  const name = backupFileName(new Date('2026-10-25T01:02:03Z'), '../tenant');
  assert.equal(name, 'tenant-.._tenant-20261025-010203.dump');
  assert.equal(safeDbName('a/b c'), 'a_b_c');
});

test('解析备份时间；非法文件返回 null', () => {
  assert.equal(parseBackupDate('tenant-db-20261025-010203.dump').toISOString(), '2026-10-25T01:02:03.000Z');
  assert.equal(parseBackupDate('manual.dump'), null);
  assert.equal(parseBackupDate('tenant-db-20261340-010203.dump'), null);
});

test('过期文件按保留天数筛选，无法解析的保留', () => {
  const now = new Date('2026-10-25T00:00:00Z');
  const files = [
    'tenant-db-20261001-000000.dump', // 24 天前
    'tenant-db-20261020-000000.dump', // 5 天前
    'manual.dump',
  ];
  assert.deepEqual(expiredBackups(files, { now, retentionDays: 14 }), ['tenant-db-20261001-000000.dump']);
  assert.deepEqual(expiredBackups(files, { now, retentionDays: 0 }), []);
});

const source = 'postgresql://source:password@db.example:5432/tenant';

test('同一数据库与账号、密码、默认端口及非路由参数无关', () => {
  assert.equal(sameDatabaseTarget(source, 'postgres://other:password@DB.EXAMPLE./ten%61nt?sslmode=require'), true);
  assert.equal(sameDatabaseTarget(source, 'postgresql://other@db.example:05432/tenant'), true);
  assert.equal(sameDatabaseTarget(source, 'postgresql://other@db.example:5432/rehearsal'), false);
  assert.equal(sameDatabaseTarget(source, 'postgresql://other@db.example:5433/tenant'), false);
});

test('缺少目标和包含路由覆盖的连接串无法比较', () => {
  for (const target of [
    undefined,
    'postgresql://other@db.example',
    'postgresql://other@db.example,other.example/tenant',
    'postgresql://other@/tenant',
    'postgresql://other@db.example/rehearsal?%64bname=tenant',
    'postgresql://other@db.example/other/../tenant',
  ]) {
    assert.equal(sameDatabaseTarget(source, target), null);
  }
});
