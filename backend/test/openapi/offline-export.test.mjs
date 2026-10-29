import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

for (const command of ['openapi:generate', 'openapi:check']) {
  test(`${command} runs without network, env file, or runtime app`, () => {
    const env = { ...process.env, NODE_OPTIONS: `--require=${resolve('test/openapi/block-external.cjs')}` };
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_DB', 'REDIS_PASSWORD']) delete env[key];
    const result = spawnSync('npm', ['run', command], { cwd: process.cwd(), env, encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stdout + result.stderr, /OFFLINE_EXPORT_BLOCKED|NETWORK_BLOCKED/);
    const source = readFileSync('src/openapi/export-openapi.ts', 'utf8');
    assert.doesNotMatch(source, /from ['"].*app\.module/);
    assert.doesNotMatch(source, /extends Controller|super\(/);
    assert.match(source, /@Module\(\{ controllers: offlineControllers \}\)/);
    assert.match(source, /class OfflineController \{\}/);
    const document = JSON.parse(readFileSync('openapi.json', 'utf8'));
    assert.ok(document.paths['/api/bills']);
    assert.equal(Object.values(document.paths).reduce((n, path) => n + Object.keys(path).filter(key => ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(key)).length, 0), 289);
    assert.equal(document.components.schemas.CreateRefundDto.required.includes('requestKey'), true);
    assert.equal(document.paths['/api/bills'].get.responses['200'].content['application/json'].schema.properties.data.items.properties.currentOverdueDays.type, 'integer');
  });
}
