import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./restore-rehearsal.sh', import.meta.url));
const source = 'postgresql://primary@db.example:5432/tenant';
const rehearsal = 'postgresql://operator@db.example/rehearsal';

function runRehearsal(t, envOverrides, { comparatorFails = false, expectedTarget = envOverrides.REHEARSAL_DATABASE_URL ?? rehearsal } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'restore-rehearsal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const dump = join(directory, 'backup.dump');
  const restoreMarker = join(directory, 'restore-called');
  const queryMarker = join(directory, 'query-called');
  writeFileSync(dump, '');
  writeFileSync(join(directory, 'pg_restore'), '#!/bin/sh\ntouch "$RESTORE_MARKER"\n[ "$1" = "--dbname=$EXPECTED_TARGET" ] && [ -z "${PGPORT+x}" ]\n', { mode: 0o700 });
  writeFileSync(join(directory, 'psql'), '#!/bin/sh\n[ "$1" = "$EXPECTED_TARGET" ] && [ -z "${PGPORT+x}" ] || exit 1\necho query >> "$QUERY_MARKER"\necho 20\n', { mode: 0o700 });

  if (comparatorFails) {
    writeFileSync(join(directory, 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  }

  const result = spawnSync('bash', [script, dump, '--yes'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: directory + delimiter + process.env.PATH,
      RESTORE_MARKER: restoreMarker,
      QUERY_MARKER: queryMarker,
      EXPECTED_TARGET: expectedTarget,
      DATABASE_URL: source,
      REHEARSAL_DATABASE_URL: rehearsal,
      PGHOSTADDR: '',
      PGPORT: '',
      PGSERVICE: '',
      ...envOverrides,
    },
  });
  assert.ifError(result.error);
  const queries = existsSync(queryMarker) ? readFileSync(queryMarker, 'utf8').trim().split('\n').length : 0;
  return { ...result, restored: existsSync(restoreMarker), queries };
}

test('同库但账号不同，演练在调用 pg_restore 前停止', (t) => {
  const result = runRehearsal(t, { REHEARSAL_DATABASE_URL: 'postgres://operator@DB.EXAMPLE/tenant?sslmode=require' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /指向同一数据库/);
  assert.equal(result.restored, false);
});

test('连接地址无法比较时拒绝恢复', (t) => {
  for (const key of ['host', 'hostaddr', 'port', '%64bname', 'service']) {
    const result = runRehearsal(t, { REHEARSAL_DATABASE_URL: `${rehearsal}?schema=public&${key}=other` });
    assert.equal(result.status, 1, key);
    assert.match(result.stderr, /无法比较/);
    assert.equal(result.restored, false);
    assert.equal(result.queries, 0);
  }
});

test('来源库未设置时拒绝恢复', (t) => {
  const result = runRehearsal(t, { DATABASE_URL: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须设置 DATABASE_URL/);
  assert.equal(result.restored, false);
});

test('目标比较进程失败时拒绝恢复', (t) => {
  const result = runRehearsal(t, {}, { comparatorFails: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /无法比较/);
  assert.equal(result.restored, false);
});

test('环境变量可覆盖连接路由时拒绝恢复', (t) => {
  const result = runRehearsal(t, { PGHOSTADDR: '192.0.2.1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /可覆盖连接目标/);
  assert.equal(result.restored, false);
});

test('PGPORT 使省略端口的来源与显式端口目标指向同库时不调用恢复', (t) => {
  const result = runRehearsal(t, {
    DATABASE_URL: 'postgresql://owner@db.example/tenant',
    REHEARSAL_DATABASE_URL: 'postgresql://operator@db.example:5433/tenant',
    PGPORT: '5433',
  });
  assert.equal(result.restored, false);
  assert.equal(result.queries, 0);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PGPORT/);
});

test('确认独立演练库后，仅将恢复指向该库', (t) => {
  const result = runRehearsal(t, {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[rehearsal\] 通过/);
  assert.equal(result.restored, true);
});

test('Prisma 连接串只移除 schema，并将同一目标交给恢复与三次校验', (t) => {
  for (const [query, retained] of [
    ['?schema=public', ''],
    ['?sslmode=require&%73chema=public&application_name=restore%20check', '?sslmode=require&application_name=restore%20check'],
  ]) {
    const result = runRehearsal(t, {
      DATABASE_URL: source + '?schema=public',
      REHEARSAL_DATABASE_URL: rehearsal + query,
    }, { expectedTarget: rehearsal + retained });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.restored, true);
    assert.equal(result.queries, 3);
  }
});
