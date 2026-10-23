import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCHEMA_FROM,
  DEFAULT_STRICT_FROM,
  analyzeTasks,
  isHandoffRegistered,
  isLegacyTask,
  taskIdCoversFileId,
} from './task-check.mjs';

function task(number, meta = {}, overrides = {}) {
  return {
    file: `tasks/T${number}-test.md`,
    fileName: `T${number}-test.md`,
    id: `T${number}`,
    number,
    title: `T${number}：测试任务`,
    meta,
    hasFrontMatter: true,
    ...overrides,
  };
}

const always = (value) => () => value;
const exists = (paths) => (value) => paths.includes(value);

test('isLegacyTask 以任務號與 enforcement 分級', () => {
  assert.equal(DEFAULT_STRICT_FROM, 230);
  assert.equal(isLegacyTask(task(229)), true);
  assert.equal(isLegacyTask(task(230)), false);
  assert.equal(isLegacyTask(task(100, { enforcement: 'strict' })), false);
  assert.equal(isLegacyTask(task(230, { enforcement: 'legacy' })), true);
});

test('taskIdCoversFileId 接受區間與精確 ID，拒絕錯配', () => {
  assert.equal(taskIdCoversFileId('T116-T119', 'T116'), true);
  assert.equal(taskIdCoversFileId('T230', 'T230'), true);
  assert.equal(taskIdCoversFileId('T231', 'T230'), false);
});

test('重複的 legacy T165 只產生 warning，不讓檢查失敗', () => {
  const tasks = [
    task(165, { status: 'active', stage: '阶段3', task_id: 'T165' }, {
      file: 'tasks/T165-a.md',
      fileName: 'T165-a.md',
    }),
    task(165, { status: 'active', stage: '阶段3', task_id: 'T165' }, {
      file: 'tasks/T165-b.md',
      fileName: 'T165-b.md',
    }),
  ];
  const result = analyzeTasks(tasks, {
    isAncestor: always(null),
    pathExists: always(true),
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.filter((item) => item.code === 'duplicate-task-id').length, 2);
  assert.equal(result.ok, true);
});

test('T164/T165 缺 front matter 時不崩潰，legacy 只警告', () => {
  const tasks = [
    task(164, {}, { hasFrontMatter: false }),
    task(165, {}, {
      fileName: 'T165-后台运行修复.md',
      file: 'tasks/T165-后台运行修复.md',
      hasFrontMatter: false,
    }),
  ];
  const result = analyzeTasks(tasks);

  assert.equal(result.counts.total, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(
    result.warnings.filter((item) => item.code === 'missing-front-matter').length,
    2,
  );
});

test('strict completed 缺 merge 與 handoff 是 error', () => {
  const result = analyzeTasks(
    [
      task(230, {
        status: 'completed',
        stage: '第五阶段',
        branch: 'feature/T230-room-photos',
        handoff: 'docs/handoff/2026-10-21-T230.md',
      }),
    ],
    { isAncestor: always(false), pathExists: always(false), docsIndex: '' },
  );

  assert.equal(result.errors.some((item) => item.code === 'missing-merge-evidence'), true);
  assert.equal(result.errors.some((item) => item.code === 'missing-handoff'), true);
  assert.equal(result.ok, false);
});

test('strict completed 有 merge 但缺 handoff/INDEX 分別報錯', () => {
  const base = {
    status: 'completed',
    stage: '第五阶段',
    branch: 'feature/T230-room-photos',
    handoff: 'docs/handoff/2026-10-21-T230.md',
  };

  const missingFile = analyzeTasks([task(230, base)], {
    isAncestor: always(true),
    pathExists: always(false),
    docsIndex: '2026-10-21-T230.md',
  });
  assert.deepEqual(
    missingFile.errors.map((item) => item.code),
    ['missing-handoff'],
  );

  const unregistered = analyzeTasks([task(230, base)], {
    isAncestor: always(true),
    pathExists: always(true),
    docsIndex: '- [T229](./handoff/T229.md)',
  });
  assert.deepEqual(
    unregistered.errors.map((item) => item.code),
    ['unregistered-handoff'],
  );

  const valid = analyzeTasks([task(230, base)], {
    isAncestor: always(true),
    pathExists: exists([base.handoff]),
    docsIndex: '- [2026-10-21-T230.md](./handoff/2026-10-21-T230.md)',
  });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.ok, true);
  assert.equal(isHandoffRegistered(base.handoff, '- [T230](./handoff/2026-10-21-T230.md)'), true);
});

test('legacy completed 的證據缺口只算 warning', () => {
  const result = analyzeTasks(
    [
      task(229, {
        status: 'completed',
        stage: '第五阶段',
        branch: 'feature/T229-old',
        handoff: 'docs/handoff/T229.md',
      }),
    ],
    { isAncestor: always(false), pathExists: always(false), docsIndex: '' },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.some((item) => item.code === 'missing-merge-evidence'), true);
  assert.equal(result.warnings.some((item) => item.code === 'missing-handoff'), true);
});

test('strict 任務的 task_id 錯配、無效 status、缺 stage 都是 error', () => {
  const mismatch = analyzeTasks([
    task(230, { status: 'active', stage: '第五阶段', task_id: 'T231' }),
  ]);
  assert.equal(mismatch.errors.some((item) => item.code === 'task-id-mismatch'), true);

  const range = analyzeTasks([
    task(116, { status: 'active', stage: '阶段1', task_id: 'T116-T119' }, {
      fileName: 'T116-T119-rooms.md',
      number: 116,
      id: 'T116-T119',
    }),
  ], { strictFrom: 100 });
  assert.equal(range.errors.some((item) => item.code === 'task-id-mismatch'), false);

  const invalid = analyzeTasks([task(230, { status: 'mystery', stage: '第五阶段' })]);
  assert.equal(invalid.errors.some((item) => item.code === 'invalid-status'), true);

  const noStage = analyzeTasks([task(231, { status: 'active' })]);
  assert.equal(noStage.errors.some((item) => item.code === 'missing-stage'), true);
});

test('schema 門檻從 T250 開始：缺 plan_ref / acceptance_evidence 是 error', () => {
  assert.equal(DEFAULT_SCHEMA_FROM, 250);

  const result = analyzeTasks([task(250, { status: 'active', stage: 'M0' })]);
  const codes = result.errors.map((item) => item.code);
  assert.equal(codes.includes('missing-plan-ref'), true);
  assert.equal(codes.includes('missing-acceptance-evidence'), true);
  assert.equal(result.ok, false);
});

test('schema 任務的 plan_ref / blocked_by / evidence 格式會驗證', () => {
  const result = analyzeTasks([
    task(252, {
      status: 'active',
      stage: 'M1',
      plan_ref: 'ops_1',
      blocked_by: 'DEC-10, T25, 人工',
      acceptance_evidence: 'docs/evidence/T252.md',
    }),
  ]);
  const codes = result.errors.map((item) => item.code);
  assert.equal(codes.includes('invalid-plan-ref'), true);
  assert.equal(codes.includes('invalid-blocked-by'), true);
  assert.equal(codes.includes('invalid-acceptance-evidence'), true);
});

test('schema 任務欄位齊全時通過；completed 有 blockers 或 evidence 不存在會報錯', () => {
  const base = {
    status: 'active',
    stage: 'M0',
    plan_ref: 'M0',
    acceptance_evidence: 'tasks/evidence/T250.md',
  };

  const valid = analyzeTasks([task(250, base)], {
    pathExists: exists(['tasks/evidence/T250.md']),
  });
  assert.equal(valid.errors.length, 0);

  const completedWithBlocker = analyzeTasks(
    [task(250, { ...base, execution_status: 'completed', blocked_by: 'DEC-04' })],
    { isAncestor: always(true), pathExists: always(true) },
  );
  assert.equal(
    completedWithBlocker.errors.some((item) => item.code === 'completed-with-blockers'),
    true,
  );

  const missingEvidence = analyzeTasks(
    [task(250, { ...base, execution_status: 'completed' })],
    { isAncestor: always(true), pathExists: always(false), docsIndex: '' },
  );
  assert.equal(
    missingEvidence.errors.some(
      (item) => item.code === 'missing-acceptance-evidence' && item.message.includes('不存在'),
    ),
    true,
  );
});

test('T230 等歷史任務不受 schema 新規則影響', () => {
  const result = analyzeTasks([
    task(230, { status: 'active', stage: '第五阶段', execution_status: 'active' }),
  ]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('enforcement: legacy 即使任務號 >= 門檻也只警告', () => {
  const result = analyzeTasks([task(230, { status: 'active', enforcement: 'legacy' })]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.some((item) => item.code === 'missing-stage'), true);
});
