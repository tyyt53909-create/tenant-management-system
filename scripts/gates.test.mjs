import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLint, parseNodeTest, parseVitest, stripAnsi } from './gates.mjs';

test('parseVitest 解析通過摘要', () => {
  const parsed = parseVitest(`
 Test Files  92 passed (92)
      Tests  918 passed (918)
`);
  assert.equal(parsed.counts.files, 92);
  assert.equal(parsed.counts.tests, 918);
  assert.equal(parsed.counts.failed, 0);
  assert.equal(parsed.evidence, '92 files / 918 tests');
});

test('parseVitest 解析失敗摘要與 ANSI', () => {
  const parsed = parseVitest(`
\u001b[31m Test Files  1 failed | 91 passed (92)\u001b[0m
\u001b[31m      Tests  1 failed | 917 passed (918)\u001b[0m
`);
  assert.equal(parsed.counts.files, 91);
  assert.equal(parsed.counts.tests, 917);
  assert.equal(parsed.counts.failed, 2);
  assert.match(parsed.evidence, /1 tests \/ 1 files failed/);
});

test('parseNodeTest 同時支援 Node 20 的 ℹ 與 Node 22 的 # 摘要', () => {
  const node20 = parseNodeTest('ℹ pass 113\nℹ fail 0');
  assert.equal(node20.counts.tests, 113);
  assert.equal(node20.counts.failed, 0);

  const node22 = parseNodeTest('# tests 113\n# pass 112\n# fail 1');
  assert.equal(node22.counts.tests, 112);
  assert.equal(node22.counts.failed, 1);
  assert.equal(node22.evidence, '112 tests（1 failed）');
});

test('parseNodeTest 沒有摘要時回傳空 evidence', () => {
  assert.equal(parseNodeTest('not a tap output').evidence, '');
});

test('parseLint 解析與缺少摘要的情況', () => {
  const parsed = parseLint('Found 168 warnings and 0 errors.');
  assert.deepEqual(parsed.counts, { warnings: 168, errors: 0 });
  assert.equal(parsed.evidence, '168 warnings / 0 errors');

  assert.equal(parseLint('clean').evidence, 'exit 0');
});

test('stripAnsi 移除顏色碼', () => {
  assert.equal(stripAnsi('\u001b[32mok\u001b[0m'), 'ok');
});
