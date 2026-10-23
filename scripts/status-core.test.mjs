import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GATES,
  checkStatusSemantics,
  classifyTask,
  computeReadiness,
  normalizeGates,
  parseBlockedBy,
  parseFrontMatter,
  parseTaskFile,
  renderStatus,
  stageKey,
  summarizeTasks,
} from './status-core.mjs';

function task(number, meta = {}, title = `T${number}：测试任务`) {
  return {
    file: `tasks/T${number}-test.md`,
    fileName: `T${number}-test.md`,
    id: `T${number}`,
    number,
    title,
    meta,
  };
}

const always = (value) => () => value;
const exists = (paths) => (value) => paths.includes(value);

test('parseFrontMatter 解析單行 YAML，並忽略無法解析的行', () => {
  const meta = parseFrontMatter(`---
status: completed
task_id: T230
stage: 第五阶段（房源运营补全）
branch: feature/T230-room-photos
handoff: docs/handoff/2026-10-21-T230-房源照片上传.md
note: "含：冒號與 # 號"
empty:
---
# T230：房源照片上传
`);

  assert.equal(meta.status, 'completed');
  assert.equal(meta.task_id, 'T230');
  assert.equal(meta.stage, '第五阶段（房源运营补全）');
  assert.equal(meta.branch, 'feature/T230-room-photos');
  assert.equal(meta.note, '含：冒號與 # 號');
  assert.equal(meta.empty, '');
});

test('parseFrontMatter 沒有 front matter 時回傳 null', () => {
  assert.equal(parseFrontMatter('# 沒有 metadata'), null);
  assert.equal(parseFrontMatter(''), null);
});

test('parseTaskFile 從檔名保留數字，task_id 可覆寫顯示名稱', () => {
  const parsed = parseTaskFile(
    'T116-T119-rooms.md',
    `---
status: completed
task_id: T116-T119
branch: feature/T116-rooms-crud
---
# T116-T119：房源模組
`,
  );
  assert.equal(parsed.number, 116);
  assert.equal(parsed.id, 'T116-T119');
  assert.equal(parsed.title, 'T116-T119：房源模組');
});

test('parseBlockedBy 支援逗號/分號、去空與空值', () => {
  assert.deepEqual(parseBlockedBy({ blocked_by: 'DEC-04, needs-human;M1' }), [
    'DEC-04',
    'needs-human',
    'M1',
  ]);
  assert.deepEqual(parseBlockedBy({ blocked_by: '' }), []);
  assert.deepEqual(parseBlockedBy({}), []);
  assert.deepEqual(parseBlockedBy({ blockedBy: 'T255' }), ['T255']);
});

test('parseTaskFile 讀出 plan_ref、blocked_by 與 acceptance_evidence', () => {
  const parsed = parseTaskFile(
    'T250-M0.md',
    `---
status: active
execution_status: active
task_id: T250
plan_ref: M0
blocked_by: DEC-04, needs-human
acceptance_evidence: tasks/evidence/T250.md
---
# T250：M0 生产化收口
`,
  );

  assert.equal(parsed.planRef, 'M0');
  assert.deepEqual(parsed.blockedBy, ['DEC-04', 'needs-human']);
  assert.equal(parsed.acceptanceEvidence, 'tasks/evidence/T250.md');
});

test('stageKey 支援中文、數字與優化計畫', () => {
  assert.equal(stageKey({ stage: '阶段0' }), 'stage-0');
  assert.equal(stageKey({ stage: '第二阶段（第一版试用）' }), 'stage-2');
  assert.equal(stageKey({ stage: '阶段5（房源）' }), 'stage-5');
  assert.equal(stageKey({ stage: '优化计划 M1 / OPT-01' }), 'optimization');
  assert.equal(stageKey({ stage: '临时任务' }), 'unclassified');
  assert.equal(stageKey({ stage_id: 'stage-9', stage: '阶段0' }), 'stage-9');
});

test('classifyTask：有 merge 與 handoff 證據才算 verified', () => {
  const item = classifyTask(task(230, {
    status: 'completed',
    branch: 'feature/T230-room-photos',
    handoff: 'docs/handoff/2026-10-21-T230-房源照片上传.md',
  }), {
    integrationRef: 'origin/develop',
    isAncestor: always(true),
    pathExists: always(true),
    docsIndex: '- [T230](./handoff/2026-10-21-T230-房源照片上传.md)',
  });

  assert.equal(item.classification, 'verified');
  assert.equal(item.handoffRegistered, true);
});

test('classifyTask：completed 但 branch 未合併要標成 unmerged', () => {
  const item = classifyTask(task(230, {
    status: 'completed',
    branch: 'feature/T230-room-photos',
    handoff: 'docs/handoff/T230.md',
  }), {
    integrationRef: 'origin/develop',
    isAncestor: always(false),
    pathExists: always(true),
    docsIndex: './handoff/T230.md',
  });

  assert.equal(item.classification, 'unmerged');
  assert.match(item.reason, /尚未合併/);
});

test('classifyTask：歷史任務缺證據只算 legacy，不阻擋發布', () => {
  const item = classifyTask(task(100, {
    status: 'completed',
    branch: 'feature/T100-gone',
  }), {
    legacyBefore: 230,
    integrationRef: 'origin/develop',
    isAncestor: always(null),
    pathExists: always(false),
  });

  assert.equal(item.classification, 'legacy');
  assert.equal(item.reason.includes('缺 handoff'), true);
});

test('classifyTask：strict 任務缺 merge 證據要標成 unverified', () => {
  const item = classifyTask(task(231, {
    status: 'completed',
    branch: 'feature/T231-gone',
    handoff: 'docs/handoff/T231.md',
  }), {
    legacyBefore: 230,
    isAncestor: always(null),
    pathExists: always(true),
    docsIndex: './handoff/T231.md',
  });

  assert.equal(item.classification, 'unverified');
});

test('classifyTask：completed 但缺 handoff 或 handoff 未登記 INDEX', () => {
  const missing = classifyTask(task(231, {
    status: 'completed',
    merge_commit: 'abc1234',
  }), {
    legacyBefore: 230,
    isAncestor: always(true),
    pathExists: always(false),
  });
  assert.equal(missing.classification, 'missing-handoff');

  const unregistered = classifyTask(task(231, {
    status: 'completed',
    merge_commit: 'abc1234',
    handoff: 'docs/handoff/T231.md',
  }), {
    legacyBefore: 230,
    isAncestor: always(true),
    pathExists: always(true),
    docsIndex: 'docs/INDEX.md 沒有這筆',
  });
  assert.equal(unregistered.classification, 'unregistered-handoff');
});

test('classifyTask：active/draft/blocked/unknown', () => {
  const options = { isAncestor: always(null), pathExists: always(false) };
  assert.equal(classifyTask(task(231, { status: 'in_progress' }), options).classification, 'active');
  assert.equal(classifyTask(task(231, { status: 'draft' }), options).classification, 'draft');
  assert.equal(classifyTask(task(231, { status: 'blocked' }), options).classification, 'blocked');
  assert.equal(classifyTask(task(231, { status: 'weird' }), options).classification, 'unknown');
});

test('classifyTask：進行中且有 blocked_by 視為 blocked，草稿仍算 draft', () => {
  const options = { isAncestor: always(null), pathExists: always(false) };

  const activeBlocked = classifyTask(
    task(252, {
      execution_status: 'active',
      start_time: '2026-10-23',
      plan_ref: 'OPS-01',
      blocked_by: 'DEC-07, needs-human',
    }),
    options,
  );
  assert.equal(activeBlocked.classification, 'blocked');
  assert.match(activeBlocked.reason, /DEC-07, needs-human/);

  const draftBlocked = classifyTask(
    task(293, { status: 'draft', plan_ref: 'PAY-01', blocked_by: 'DEC-04' }),
    options,
  );
  assert.equal(draftBlocked.classification, 'draft');
  assert.match(draftBlocked.reason, /等待 DEC-04/);
  assert.equal(draftBlocked.planRef, 'PAY-01');
});

test('classifyTask：execution_status 優先於文件 status', () => {
  const item = classifyTask(
    task(231, {
      status: 'draft',
      execution_status: 'in_progress',
      start_time: '2026-10-21',
    }),
    { isAncestor: always(null), pathExists: always(false) },
  );

  assert.equal(item.status, 'active');
  assert.equal(item.classification, 'active');
});

test('classifyTask：文件 status=active 但沒有執行狀態時不計入進行中', () => {
  const item = classifyTask(
    task(144, {
      status: 'active',
      owner_tier: 'medium',
      last_verified: '2026-10-13',
      applies_to: ['miniprogram/**'],
      branch: 'feature/T144-cleaner-miniprogram',
    }),
    { isAncestor: always(null), pathExists: always(false) },
  );

  assert.equal(item.classification, 'doc-active');
  assert.match(item.reason, /不計入進行中/);
});

test('summarizeTasks 產生計數、活躍清單、問題清單與階段統計', () => {
  const summary = summarizeTasks(
    [
      task(100, { status: 'completed', branch: 'feature/T100', stage: '阶段1' }),
      task(230, { status: 'completed', branch: 'feature/T230', stage: '第五阶段' }),
      task(231, { status: 'active', branch: 'feature/T231', stage: '第五阶段' }),
      task(232, { status: 'draft', stage: '第五阶段' }),
    ],
    {
      legacyBefore: 230,
      integrationRef: 'origin/develop',
      isAncestor: (ref) => (ref === 'feature/T100' ? null : ref === 'feature/T230' ? false : null),
      pathExists: always(false),
    },
  );

  assert.equal(summary.counts.total, 4);
  assert.equal(summary.counts.legacy, 1);
  assert.equal(summary.counts.unmerged, 1);
  assert.equal(summary.counts.active, 1);
  assert.equal(summary.counts.draft, 1);
  assert.equal(summary.active.length, 1);
  assert.equal(summary.issues.length, 1);
  assert.equal(summary.issues[0].id, 'T230');
  assert.equal(summary.stages.find((stage) => stage.key === 'stage-5').total, 3);
});

test('normalizeGates 補齊缺少的 gate，未知狀態降級成 not-run', () => {
  const gates = normalizeGates([{ id: 'backend-unit', status: 'pass', evidence: '918 tests' }]);
  assert.equal(gates.length, DEFAULT_GATES.length);
  assert.equal(gates.find((gate) => gate.id === 'backend-unit').status, 'pass');
  assert.equal(gates.find((gate) => gate.id === 'openapi').status, 'not-run');
  assert.equal(gates.find((gate) => gate.id === 'openapi').evidence, '未提供');
});

test('computeReadiness：全部 release gate pass 才是 GO', () => {
  const allPass = DEFAULT_GATES.map((gate) => ({
    ...gate,
    status: 'pass',
    evidence: 'ok',
  }));
  assert.equal(computeReadiness(allPass).status, 'GO');

  const withFail = allPass.map((gate) =>
    gate.id === 'openapi' ? { ...gate, status: 'fail', evidence: 'drift' } : gate,
  );
  const failed = computeReadiness(withFail);
  assert.equal(failed.status, 'NO-GO');
  assert.equal(failed.reasons.some((reason) => reason.includes('OpenAPI')), true);

  const withNotRun = allPass.map((gate) =>
    gate.id === 'integration' ? { ...gate, status: 'not-run', evidence: 'pending' } : gate,
  );
  assert.equal(computeReadiness(withNotRun).status, 'NO-GO');
});

test('computeReadiness：strict 任務問題會阻擋 GO', () => {
  const allPass = DEFAULT_GATES.map((gate) => ({ ...gate, status: 'pass', evidence: 'ok' }));
  const readiness = computeReadiness(allPass, {
    blockingTasks: [{ id: 'T230', classification: 'unmerged' }],
  });
  assert.equal(readiness.status, 'NO-GO');
  assert.equal(readiness.reasons.includes('T230: unmerged'), true);
});

test('renderStatus 是確定性的，且不再輸出 100% 或假的完成範圍', () => {
  const tasks = summarizeTasks([]);
  const gates = DEFAULT_GATES.map((gate) =>
    gate.id === 'openapi'
      ? { ...gate, status: 'fail', evidence: 'openapi.json differs' }
      : gate.id === 'integration'
        ? { ...gate, status: 'not-run', evidence: 'T231 pending' }
        : { ...gate, status: 'pass', evidence: 'ok' },
  );
  const model = {
    branch: 'feature/T230-room-photos',
    integration: { ref: 'origin/develop', commit: '53df199' },
    gates,
    readiness: computeReadiness(gates),
    tasks,
    metrics: { modelCount: 34, routeCount: 140, backendLines: 16966 },
    handoffs: [{ title: 'T230 房源照片上传', path: 'docs/handoff/T230.md' }],
  };

  const first = renderStatus(model);
  const second = renderStatus(model);

  assert.equal(first, second);
  assert.match(first, /發布就緒: \*\*NO-GO\*\*/);
  assert.match(first, /OpenAPI 生成物 \| ❌ fail/);
  assert.doesNotMatch(first, /工作樹/);
  assert.match(first, /34\*\* 張表/);
  assert.doesNotMatch(first, /100%/);
  assert.doesNotMatch(first, /T001~T\d+/);
  assert.doesNotMatch(first, /阻塞问题 0/);
  assert.doesNotMatch(first, /進度趨勢/);
});

test('renderStatus 進行中任務顯示 plan_ref', () => {
  const tasks = summarizeTasks(
    [task(250, { execution_status: 'active', start_time: '2026-10-23', plan_ref: 'M0' })],
    { isAncestor: always(null), pathExists: always(false) },
  );
  const content = renderStatus({
    branch: 'docs/T250-m0-closeout',
    gates: DEFAULT_GATES,
    tasks,
    readiness: computeReadiness(DEFAULT_GATES),
    metrics: {},
  });

  assert.match(content, /T250 测试任务\*\*（active，plan M0）/);
});

test('renderStatus 在沒有 gate 時不會把 not-run 寫成 pass', () => {
  const tasks = summarizeTasks([]);
  const gates = normalizeGates([]);
  const content = renderStatus({
    branch: 'develop',
    gates,
    tasks,
    readiness: computeReadiness(gates),
  });

  assert.match(content, /⏸ not-run/);
  assert.doesNotMatch(content, /✅ pass/);
});

test('checkStatusSemantics：Gate/任務/模型數一致時通過', () => {
  const tasks = summarizeTasks([]);
  const gates = DEFAULT_GATES.map((gate) =>
    gate.id === 'openapi'
      ? { ...gate, status: 'fail', evidence: 'drift' }
      : gate.id === 'integration'
        ? { ...gate, status: 'not-run', evidence: 'pending' }
        : { ...gate, status: 'pass', evidence: 'ok' },
  );
  const readiness = computeReadiness(gates);
  const metrics = { modelCount: 34, routeCount: 140 };
  const content = renderStatus({
    branch: 'develop',
    dirtyFiles: 0,
    gates,
    readiness,
    tasks,
    metrics,
  });

  const result = checkStatusSemantics(content, { gates, readiness, tasks, metrics });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('checkStatusSemantics：抓到阻擋發布的任務 ID 被換掉', () => {
  const tasks = summarizeTasks(
    [task(230, { status: 'completed', branch: 'feature/T230-room-photos' })],
    {
      legacyBefore: 230,
      integrationRef: 'origin/develop',
      isAncestor: () => false,
      pathExists: () => true,
      docsIndex: './handoff/T230.md',
    },
  );
  const gates = DEFAULT_GATES.map((gate) => ({ ...gate, status: 'pass', evidence: 'ok' }));
  const readiness = computeReadiness(gates, { blockingTasks: tasks.blocking });
  const metrics = { modelCount: 34, routeCount: 140 };
  const content = renderStatus({ branch: 'develop', gates, readiness, tasks, metrics });
  const model = { gates, readiness, tasks, metrics };

  assert.equal(checkStatusSemantics(content, model).ok, true);
  const tampered = content.replace('**T230 ', '**T999 ');
  const result = checkStatusSemantics(tampered, model);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes('T999')), true);
  assert.equal(result.errors.some((error) => error.includes('缺少 T230')), true);
});

test('checkStatusSemantics：抓到假的 GO、Gate 狀態、任務數與模型數', () => {
  const tasks = summarizeTasks([]);
  const gates = DEFAULT_GATES.map((gate) => ({ ...gate, status: 'pass', evidence: 'ok' }));
  const readiness = computeReadiness(gates);
  const metrics = { modelCount: 34, routeCount: 140 };
  const content = renderStatus({ branch: 'develop', gates, readiness, tasks, metrics });
  const model = { gates, readiness, tasks, metrics };

  assert.equal(checkStatusSemantics(content.replace('**GO**', '**NO-GO**'), model).ok, false);
  assert.equal(
    checkStatusSemantics(
      content.replace('| OpenAPI 生成物 | ✅ pass |', '| OpenAPI 生成物 | ❌ fail |'),
      model,
    ).ok,
    false,
  );
  assert.equal(
    checkStatusSemantics(content.replace('| 已驗證完成 | 0 |', '| 已驗證完成 | 1 |'), model).ok,
    false,
  );
  assert.equal(
    checkStatusSemantics(content.replace('**34** 張表', '**99** 張表'), model).ok,
    false,
  );
  assert.equal(
    checkStatusSemantics(content.replace('Gates: 14 pass / 0 fail / 0 not-run', 'Gates: 99 pass / 0 fail / 0 not-run'), model).ok,
    false,
  );
});

