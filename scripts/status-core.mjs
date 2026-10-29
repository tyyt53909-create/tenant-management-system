/**
 * STATUS.md 的純邏輯：任務解析、證據判定、Gate 判定與 Markdown 渲染。
 *
 * 這個模組不讀檔、不執行 git、不跑測試。所有 I/O 由 generate-status.mjs 注入，
 * 讓同一份輸入可以產生 byte-identical 的輸出，也讓規則可以在單元測試裡驗證。
 */

export const DEFAULT_LEGACY_BEFORE = 230;

export const DEFAULT_GATES = Object.freeze([
  { id: 'backend-lint', label: '後端 lint', required: true, release: true },
  { id: 'backend-tsc', label: '後端型別檢查', required: true, release: true },
  { id: 'backend-unit', label: '後端單元測試', required: true, release: true },
  { id: 'backend-e2e', label: '後端 e2e', required: true, release: true },
  { id: 'frontend-lint', label: '管理後台 lint', required: true, release: true },
  { id: 'frontend-unit', label: '管理後台單元測試', required: true, release: true },
  { id: 'frontend-build', label: '管理後台 build', required: true, release: true },
  { id: 'miniprogram-unit', label: '小程序單元測試', required: true, release: true },
  { id: 'miniprogram-build', label: '小程序 build', required: true, release: true },
  { id: 'openapi', label: 'OpenAPI 生成物', required: true, release: true },
  { id: 'docs', label: '文檔檢查', required: true, release: true },
  { id: 'integration', label: '整合測試', required: false, release: true },
  { id: 'security', label: '安全掃描', required: false, release: true },
  { id: 'manual-uat', label: '人工 UAT', required: false, release: true },
]);

const GATE_STATUSES = new Set(['pass', 'fail', 'not-run', 'blocked']);

const CN_STAGES = {
  一: 'stage-1',
  二: 'stage-2',
  三: 'stage-3',
  四: 'stage-4',
  五: 'stage-5',
};

/**
 * 解析 Markdown 的 YAML front matter。只支援 status/task_id/stage 這類單行 key: value，
 * 不引入 YAML 依賴；遇到無法解析的行就跳過，不讓一份任務書毀掉整份看板。
 */
export function parseFrontMatter(text) {
  if (typeof text !== 'string') return null;
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!source.startsWith('---\n')) return null;
  const end = source.indexOf('\n---', 4);
  if (end === -1) return null;

  const meta = {};
  for (const line of source.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (!value) {
      meta[key] = '';
      continue;
    }
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    meta[key] = value === 'null' || value === '~' ? null : value;
  }
  return meta;
}

/**
 * 把 blocked_by 拆成陣列。front matter 只支援單行 key: value，
 * 因此用逗號/分號分隔；空值代表沒有阻塞。
 */
export function parseBlockedBy(meta = {}) {
  const raw = meta.blocked_by ?? meta.blockedBy;
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : String(raw).split(/[,;]/);
  return values.map((value) => String(value).trim()).filter(Boolean);
}

/** 從檔名與 front matter 建立一個任務物件。task_id 可能是 T116-T119，排序仍用檔名數字。 */
export function parseTaskFile(fileName, text) {
  const meta = parseFrontMatter(text) || {};
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || fileName.replace(/\.md$/, '');
  const fileId = fileName.match(/^(T\d+)/)?.[1] || '';
  const number = Number(fileId.slice(1)) || 0;
  return {
    file: `tasks/${fileName}`,
    fileName,
    id: meta.task_id || fileId || fileName.replace(/\.md$/, ''),
    number,
    title,
    planRef: meta.plan_ref || '',
    blockedBy: parseBlockedBy(meta),
    acceptanceEvidence: meta.acceptance_evidence || '',
    meta,
    text,
  };
}

/** 單一紀錄需明確列出驗收結果及可追溯證據。 */
export function hasSingleRecordEvidence(task) {
  const text = String(task.text || '');
  const section = text.match(/^## 验收证据\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim() || '';
  // 每一行是本任务的必要验收项：结果 | 执行命令 | 结果摘要 | 版本或证据引用。
  const rows = section.split('\n').map(line => line.trim()).filter(Boolean);
  return task.meta?.acceptance_status === 'pass' && rows.length > 0 && rows.every(line => {
    const match = line.match(/^- (pass|fail|not-run) \| ([^|]+) \| ([^|]+) \| ([^|]+)$/i);
    if (!match || match[1].toLowerCase() !== 'pass') return false;
    const fields = match.slice(2).map(value => value.trim());
    return fields.every(value => value.length >= 3) &&
      !fields.some(value => /^(?:not[-_ ]run|todo|未运行|未運行|未验收|未驗收|无|無|none|n\/a)$/i.test(value)) &&
      /(?:[a-f0-9]{7,40}|https?:\/\/\S+|[\w./-]+\.(?:log|json|xml|txt))/i.test(fields[2]);
  });
}

/** 把歷史任務與新任務的狀態寫法收斂成 completed/active/draft/blocked/unknown。 */
export function normalizeStatus(value) {
  const status = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (['completed', 'complete', 'done', 'merged', 'verified'].includes(status)) return 'completed';
  if (['active', 'in_progress', 'in_review', 'review', 'doing'].includes(status)) return 'active';
  if (['blocked', 'on_hold'].includes(status)) return 'blocked';
  if (['draft', 'todo', 'pending', 'planned', 'new'].includes(status)) return 'draft';
  return 'unknown';
}

export function stageKey(meta = {}) {
  if (meta.stage_id) return String(meta.stage_id).trim();
  const stage = String(meta.stage || '');
  const cn = stage.match(/第([一二三四五])阶段/);
  if (cn) return CN_STAGES[cn[1]];
  const numeric = stage.match(/阶段\s*([0-9])/);
  if (numeric) return `stage-${numeric[1]}`;
  if (/优化计划|OPT-/i.test(stage)) return 'optimization';
  return 'unclassified';
}

export function stageLabel(key) {
  if (key === 'optimization') return '優化計畫';
  if (key === 'unclassified') return '未分類';
  const match = String(key).match(/^stage-(\d+)$/);
  return match ? `階段 ${match[1]}` : key;
}

function isHandoffRegistered(handoff, docsIndex) {
  if (!handoff || !docsIndex) return null;
  const relative = handoff.replace(/^docs\//, './');
  const fileName = handoff.split('/').pop();
  return docsIndex.includes(handoff) || docsIndex.includes(relative) || docsIndex.includes(fileName);
}

/**
 * 判定單一任務的分類。merged 由外部注入的 isAncestor 決定：
 * true=已合併、false=未合併、null=branch/commit 已不存在，無法判斷。
 */
export function classifyTask(task, options = {}) {
  const {
    legacyBefore = DEFAULT_LEGACY_BEFORE,
    integrationRef = 'origin/develop',
    isAncestor = () => null,
    pathExists = () => false,
    docsIndex = '',
  } = options;

  const meta = task.meta || {};
  // execution_status 是明確的執行狀態；舊任務書的 status 可能只是文件狀態。
  const status = normalizeStatus(meta.execution_status ?? meta.status);
  // 舊任務書的 status 有時是「文件狀態」（搭配 owner_tier/last_verified），
  // 不是執行狀態。沒有 execution_status/start_time 時，不能把它當成進行中。
  const hasExecutionMetadata = Boolean(
    meta.execution_status || meta.start_time || meta.complete_time || meta.completed_time,
  );
  const hasDocMetadata = Boolean(meta.owner_tier || meta.last_verified || meta.applies_to);
  const legacy =
    meta.enforcement === 'legacy' ||
    (meta.enforcement !== 'strict' && Number(task.number) < Number(legacyBefore));
  const evidenceRef = meta.merge_commit || meta.branch || '';
  const merged = evidenceRef ? isAncestor(evidenceRef, integrationRef) : null;
  const handoff = meta.handoff || '';
  const handoffExists = handoff ? Boolean(pathExists(handoff)) : false;
  const handoffRegistered = isHandoffRegistered(handoff, docsIndex);
  const blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy : parseBlockedBy(meta);
  const blockerText = blockedBy.join(', ');

  let classification = 'unknown';
  let reason = '無法解析 status';

  if (status === 'completed') {
    if (merged === false) {
      classification = 'unmerged';
      reason = `completed，但 ${evidenceRef || 'branch'} 尚未合併進 ${integrationRef}`;
    } else if (legacy) {
      classification = 'legacy';
      reason = '歷史 completed，缺可驗證的 merge 證據';
      if (!handoffExists) reason += '；且缺 handoff';
      else if (handoffRegistered === false) reason += '；handoff 未登記 INDEX';
    } else if (meta.record_format === 'single' && (blockedBy.length || !hasSingleRecordEvidence(task))) {
      classification = 'unverified';
      reason = '单一记录验收证据缺失或仍有阻塞';
    } else if (meta.record_format === 'single' && merged === true) {
      classification = 'verified';
      reason = 'completed，合入与单一记录证据齐全';
    } else if (!handoffExists) {
      classification = 'missing-handoff';
      reason = 'completed，但 handoff 檔案不存在';
    } else if (handoffRegistered === false) {
      classification = 'unregistered-handoff';
      reason = 'completed，但 handoff 未登記在 docs/INDEX.md';
    } else if (merged === true) {
      classification = 'verified';
      reason = 'completed，merge 與 handoff 證據齊全';
    } else {
      classification = 'unverified';
      reason = 'completed，但缺 merge 證據（strict）';
    }
  } else if (status === 'active') {
    if (!hasExecutionMetadata && hasDocMetadata) {
      classification = 'doc-active';
      reason = '文件 status=active，但缺 execution_status/start_time；不計入進行中';
    } else if (blockedBy.length) {
      classification = 'blocked';
      reason = `進行中，但等待 ${blockerText}`;
    } else {
      classification = 'active';
      reason = '進行中';
    }
  } else if (status === 'blocked') {
    classification = 'blocked';
    reason = blockedBy.length ? `blocked；等待 ${blockerText}` : 'blocked';
  } else if (status === 'draft') {
    // 草稿任務常有「等人拍板」的 blocked_by；那不是發布阻擋，避免灌爆阻擋清單。
    classification = 'draft';
    reason = blockedBy.length ? `尚未開工；等待 ${blockerText}` : '尚未開工';
  }

  return {
    ...task,
    status,
    planRef: task.planRef || meta.plan_ref || '',
    blockedBy,
    acceptanceEvidence: task.acceptanceEvidence || meta.acceptance_evidence || '',
    stageKey: stageKey(meta),
    legacy,
    merged,
    handoffExists,
    handoffRegistered,
    classification,
    reason,
  };
}

function stageOrder(key) {
  const match = String(key).match(/^stage-(\d+)$/);
  if (match) return Number(match[1]);
  if (key === 'optimization') return 90;
  return 99;
}

export function summarizeStages(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.stageKey || 'unclassified';
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: stageLabel(key),
        total: 0,
        completed: 0,
        verified: 0,
        open: 0,
        other: 0,
      });
    }
    const row = map.get(key);
    row.total += 1;
    if (item.status === 'completed') row.completed += 1;
    if (item.classification === 'verified') row.verified += 1;
    if (['active', 'draft', 'blocked'].includes(item.classification)) row.open += 1;
    if (['doc-active', 'unknown'].includes(item.classification)) row.other += 1;
  }
  return [...map.values()].sort(
    (a, b) => stageOrder(a.key) - stageOrder(b.key) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
  );
}

export function summarizeTasks(tasks, options = {}) {
  const items = tasks.map((task) => classifyTask(task, options));
  const counts = {
    total: items.length,
    verified: 0,
    legacy: 0,
    unmerged: 0,
    missingHandoff: 0,
    unregisteredHandoff: 0,
    unverified: 0,
    active: 0,
    docActive: 0,
    draft: 0,
    blocked: 0,
    unknown: 0,
  };

  for (const item of items) {
    switch (item.classification) {
      case 'verified':
        counts.verified += 1;
        break;
      case 'legacy':
        counts.legacy += 1;
        break;
      case 'unmerged':
        counts.unmerged += 1;
        break;
      case 'missing-handoff':
        counts.missingHandoff += 1;
        break;
      case 'unregistered-handoff':
        counts.unregisteredHandoff += 1;
        break;
      case 'unverified':
        counts.unverified += 1;
        break;
      case 'active':
        counts.active += 1;
        break;
      case 'doc-active':
        counts.docActive += 1;
        break;
      case 'draft':
        counts.draft += 1;
        break;
      case 'blocked':
        counts.blocked += 1;
        break;
      default:
        counts.unknown += 1;
    }
  }

  const active = items.filter((item) => item.classification === 'active');
  const blocking = items.filter((item) =>
    ['unmerged', 'missing-handoff', 'unregistered-handoff', 'unverified', 'blocked'].includes(
      item.classification,
    ),
  );
  const issues = items.filter((item) =>
    [
      'unmerged',
      'missing-handoff',
      'unregistered-handoff',
      'unverified',
      'blocked',
      'doc-active',
      'unknown',
    ].includes(item.classification),
  );
  const stages = summarizeStages(items);

  return { items, counts, active, issues, blocking, stages };
}

/** 補齊缺少的 Gate，並把未知狀態降級成 not-run，避免「沒跑」被誤認為「通過」。 */
export function normalizeGates(input) {
  const source = Array.isArray(input) ? input : input?.gates;
  const provided = new Map((source || []).map((gate) => [gate.id, gate]));
  return DEFAULT_GATES.map((definition) => {
    const gate = provided.get(definition.id);
    const status = GATE_STATUSES.has(gate?.status) ? gate.status : 'not-run';
    return {
      ...definition,
      status,
      evidence: gate?.evidence || (status === 'not-run' ? '未提供' : ''),
      durationMs: gate?.durationMs,
      counts: gate?.counts,
    };
  });
}

/**
 * 發布就緒只看證據：所有 release gate 都 pass，且沒有 strict 任務卡在
 * unmerged / missing-handoff / unregistered-handoff / unverified / blocked。
 */
export function computeReadiness(gates, options = {}) {
  const list = normalizeGates(gates);
  const blockingTasks = options.blockingTasks || [];
  const reasons = [];

  for (const gate of list) {
    if (gate.release && gate.status !== 'pass') {
      reasons.push(`${gate.label}: ${gate.status}`);
    }
  }
  for (const task of blockingTasks) {
    reasons.push(`${task.id}: ${task.classification}`);
  }

  return {
    status: reasons.length === 0 ? 'GO' : 'NO-GO',
    passed: list.filter((gate) => gate.status === 'pass').length,
    failed: list.filter((gate) => gate.status === 'fail' || gate.status === 'blocked').length,
    notRun: list.filter((gate) => gate.status === 'not-run').length,
    total: list.length,
    reasons,
  };
}

const TASK_COUNT_LABELS = {
  已驗證完成: 'verified',
  '歷史完成（缺 merge 證據）': 'legacy',
  '已完成但未合併': 'unmerged',
  '已完成但缺 handoff': 'missingHandoff',
  'handoff 未登記 INDEX': 'unregisteredHandoff',
  '已完成但缺 merge 證據（strict）': 'unverified',
  進行中: 'active',
  '文件 active（不計入進行中）': 'docActive',
  草稿: 'draft',
  阻塞: 'blocked',
  無法分類: 'unknown',
};

function sectionBody(text, heading) {
  const lines = String(text).split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('### ') || line.startsWith('## ')) break;
    body.push(line);
  }
  return body;
}

/**
 * 語意檢查：不要求 Markdown byte-identical（gate evidence、branch 等
 * 會隨環境/提交變動），但要求「發布就緒、Gates 摘要、每個 Gate 狀態、
 * 任務計數、模型/路由數」與目前證據一致。
 *
 * CI 用這個檢查，避免 STATUS.md 說 GO 而 gate 是紅的；本機仍可用 --check
 * 做 byte-level 的「忘記重新生成」檢查。
 */
export function checkStatusSemantics(markdown, model = {}) {
  const text = String(markdown || '');
  const errors = [];
  const gateList = normalizeGates(model.gates);
  const readiness =
    model.readiness ||
    computeReadiness(gateList, { blockingTasks: model.tasks?.blocking || [] });
  const counts = model.tasks?.counts || {};

  const readinessMatch = text.match(/> 發布就緒: \*\*(GO|NO-GO)\*\*/);
  if (!readinessMatch) {
    errors.push('找不到「發布就緒」摘要');
  } else if (readinessMatch[1] !== readiness.status) {
    errors.push(`發布就緒為 ${readinessMatch[1]}，應為 ${readiness.status}`);
  }

  const summaryMatch = text.match(/Gates: (\d+) pass \/ (\d+) fail \/ (\d+) not-run/);
  if (!summaryMatch) {
    errors.push('找不到 Gates 摘要');
  } else {
    const actual = [
      Number(summaryMatch[1]),
      Number(summaryMatch[2]),
      Number(summaryMatch[3]),
    ];
    const expected = [readiness.passed, readiness.failed, readiness.notRun];
    if (actual.some((value, index) => value !== expected[index])) {
      errors.push(`Gates 摘要為 ${actual.join(' / ')}，應為 ${expected.join(' / ')}`);
    }
  }

  const gateStatuses = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(
      /^\|\s*(.+?)\s*\|\s*(?:✅|❌|⏸|⛔)\s*(pass|fail|not-run|blocked)\s*\|/,
    );
    if (match) gateStatuses.set(match[1], match[2]);
  }
  for (const gate of gateList) {
    const actual = gateStatuses.get(gate.label);
    if (!actual) {
      errors.push(`Gate 表缺少「${gate.label}」`);
    } else if (actual !== gate.status) {
      errors.push(`「${gate.label}」為 ${actual}，應為 ${gate.status}`);
    }
  }

  const taskCounts = new Map();
  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|/);
    if (match) taskCounts.set(match[1], Number(match[2]));
  }
  for (const [label, key] of Object.entries(TASK_COUNT_LABELS)) {
    if (!(key in counts)) continue;
    const actual = taskCounts.get(label);
    if (actual === undefined) {
      errors.push(`任務表缺少「${label}」`);
    } else if (actual !== counts[key]) {
      errors.push(`「${label}」為 ${actual}，應為 ${counts[key]}`);
    }
  }

  const blockingSection = sectionBody(text, '### 阻擋發布');
  if (!text.includes('### 阻擋發布')) {
    errors.push('找不到「阻擋發布」區塊');
  } else {
    const reportedBlocking = new Set();
    for (const line of blockingSection) {
      const match = line.match(/^-\s+\*\*(T\d+(?:-T\d+)?)/);
      if (match) reportedBlocking.add(match[1]);
    }
    const expectedBlocking = new Set((model.tasks?.blocking || []).map((task) => task.id));
    for (const id of expectedBlocking) {
      if (!reportedBlocking.has(id)) errors.push(`阻擋發布缺少 ${id}`);
    }
    for (const id of reportedBlocking) {
      if (!expectedBlocking.has(id)) errors.push(`阻擋發布列出 ${id}，但證據中沒有`);
    }
  }

  const modelMatch = text.match(/資料模型：\*\*(\d+)\*\* 張表/);
  if (
    modelMatch &&
    model.metrics?.modelCount !== undefined &&
    Number(modelMatch[1]) !== model.metrics.modelCount
  ) {
    errors.push(`資料模型為 ${modelMatch[1]}，應為 ${model.metrics.modelCount}`);
  }
  const routeMatch = text.match(/OpenAPI 路由：\*\*(\d+)\*\* 條/);
  if (
    routeMatch &&
    model.metrics?.routeCount !== undefined &&
    Number(routeMatch[1]) !== model.metrics.routeCount
  ) {
    errors.push(`OpenAPI 路由為 ${routeMatch[1]}，應為 ${model.metrics.routeCount}`);
  }

  return { ok: errors.length === 0, errors };
}

function statusIcon(status) {
  return { pass: '✅', fail: '❌', 'not-run': '⏸', blocked: '⛔' }[status] || '•';
}

function escapeCell(value) {
  return String(value ?? '—')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

function taskName(task) {
  const title = String(task.title || '')
    .replace(/^(?:T\d+(?:-T\d+)?[\s：:–—-]*)+/, '')
    .trim();
  return title ? `${task.id} ${title}` : String(task.id);
}

/**
 * 把模型渲染成 Markdown。model 由 generate-status.mjs 組裝。
 * 刻意不輸出 HEAD SHA 與 dirty 數：committed 檔案不應因「提交自己」而改變，
 * 也不應把本機工作樹狀態寫成已提交的事實。
 */
export function renderStatus(model = {}) {
  const {
    branch = 'unknown',
    integration = {},
    gates = [],
    tasks = summarizeTasks([]),
    metrics = {},
    handoffs = [],
    legacyBefore = DEFAULT_LEGACY_BEFORE,
  } = model;

  const gateList = normalizeGates(gates);
  const readiness = model.readiness || computeReadiness(gateList, { blockingTasks: tasks.blocking });
  const reasonLines = readiness.reasons.length
    ? readiness.reasons.map((reason) => `  - ${reason}`).join('\n')
    : '  - 無';

  const gateRows = gateList
    .map(
      (gate) =>
        `| ${escapeCell(gate.label)} | ${statusIcon(gate.status)} ${gate.status} | ${escapeCell(
          gate.evidence || '—',
        )} |`,
    )
    .join('\n');

  const taskCounts = [
    ['已驗證完成', tasks.counts.verified],
    ['歷史完成（缺 merge 證據）', tasks.counts.legacy],
    ['已完成但未合併', tasks.counts.unmerged],
    ['已完成但缺 handoff', tasks.counts.missingHandoff],
    ['handoff 未登記 INDEX', tasks.counts.unregisteredHandoff],
    ['已完成但缺 merge 證據（strict）', tasks.counts.unverified],
    ['進行中', tasks.counts.active],
    ['文件 active（不計入進行中）', tasks.counts.docActive],
    ['草稿', tasks.counts.draft],
    ['阻塞', tasks.counts.blocked],
    ['無法分類', tasks.counts.unknown],
  ]
    .map(([label, count]) => `| ${label} | ${count} |`)
    .join('\n');

  const taskFacts = (task) =>
    [task.planRef ? `plan ${task.planRef}` : '', task.meta?.branch ? `\`${task.meta.branch}\`` : '']
      .filter(Boolean)
      .join('，');
  const activeLines = tasks.active.length
    ? tasks.active
        .map((task) => {
          const facts = taskFacts(task);
          return `- **${taskName(task)}**（${task.status}${facts ? `，${facts}` : ''}）`;
        })
        .join('\n')
    : '- 無';

  const blockingKeys = new Set(tasks.blocking.map((task) => `${task.id}:${task.file}`));
  const blockingLines = tasks.blocking.length
    ? tasks.blocking.map((task) => `- **${taskName(task)}**：${task.reason}`).join('\n')
    : '- 無';
  const warningItems = tasks.issues.filter((task) => !blockingKeys.has(`${task.id}:${task.file}`));
  const warningLines = warningItems.length
    ? warningItems.map((task) => `- **${taskName(task)}**：${task.reason}`).join('\n')
    : '- 無';

  const stageRows = tasks.stages
    .map(
      (stage) =>
        `| ${escapeCell(stage.label)} | ${stage.total} | ${stage.completed} | ${stage.verified} | ${stage.open} | ${stage.other} |`,
    )
    .join('\n');

  const handoffLines = handoffs.length
    ? handoffs.map((handoff) => `- [${handoff.title}](${handoff.path})`).join('\n')
    : '- 無';

  const gate = (id) => gateList.find((item) => item.id === id);
  const testLines = [
    `- 後端單元：${gate('backend-unit')?.evidence || '—'}`,
    `- 後端 e2e：${gate('backend-e2e')?.evidence || '—'}`,
    `- 管理後台單元：${gate('frontend-unit')?.evidence || '—'}`,
    `- 小程序單元：${gate('miniprogram-unit')?.evidence || '—'}`,
  ].join('\n');

  const codeLines = [
    `- 資料模型：**${metrics.modelCount ?? '—'}** 張表`,
    `- OpenAPI 路由：**${metrics.routeCount ?? '—'}** 條`,
    `- 後端程式碼：**${metrics.backendLines ?? '—'}** 行`,
    `- 管理後台程式碼：**${metrics.frontendLines ?? '—'}** 行`,
    `- 小程序程式碼：**${metrics.miniprogramLines ?? '—'}** 行`,
    `- 文件：**${metrics.docCount ?? '—'}** 份`,
  ].join('\n');

  return `# 项目状态跟踪

> 分支: \`${branch}\`
> 集成基準: \`${integration.ref || 'unknown'}\` @ \`${integration.commit || 'unknown'}\`
> 發布就緒: **${readiness.status}**
> Gates: ${readiness.passed} pass / ${readiness.failed} fail / ${readiness.notRun} not-run

### NO-GO 原因
${reasonLines}

---

## 發布 Gate

| Gate | 狀態 | 證據 |
|---|---|---|
${gateRows}

---

## 任務狀態

| 狀態 | 數量 |
|---|---|
${taskCounts}

### 進行中
${activeLines}

### 阻擋發布
${blockingLines}

### 資料品質警告
${warningLines}

---

## 階段

| 階段 | 任務數 | 已完成 | 已驗證 | 未完成 | 其他 |
|---|---:|---:|---:|---:|---:|
${stageRows}

---

## 近期交接

${handoffLines}

---

## 統計

${codeLines}

### 測試
${testLines}

---

## 快速連結

- [項目主指南 (README.md)](./README.md)
- [AGENTS 協作總規則 (AGENTS.md)](./AGENTS.md)
- [架構設計與優化計畫 (docs/13-架构与现有代码优化计划.md)](./docs/13-架构与现有代码优化计划.md)
- [文檔唯一索引 (docs/INDEX.md)](./docs/INDEX.md)
- [數據模型設計 (docs/02-数据模型.md)](./docs/02-数据模型.md)
- [接口規範 (docs/05-接口规范.md)](./docs/05-接口规范.md)
- [部署與運維 (docs/12-部署与运维.md)](./docs/12-部署与运维.md)

---

_由 \`scripts/collect-gates.mjs\` + \`scripts/generate-status.mjs\` 生成；請勿手改。Legacy 門檻：T${legacyBefore}。_
`;
}
