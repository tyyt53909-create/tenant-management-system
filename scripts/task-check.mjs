#!/usr/bin/env node

/**
 * 任務書體檢：檢查 tasks/T*.md 的 front matter、ID 與 strict 任務的完成證據。
 *
 * 分級規則：
 * - 任務號 >= --strict-from（預設 230）或 enforcement: strict 的任務，違規算 error。
 * - 任務號小於門檻或 enforcement: legacy 的任務，違規只算 warning。
 *
 * 用法:
 *   node scripts/task-check.mjs
 *   node scripts/task-check.mjs --report
 *   node scripts/task-check.mjs --json
 *   node scripts/task-check.mjs --strict-from 220
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  classifyTask,
  normalizeStatus,
  parseBlockedBy,
  parseFrontMatter,
  parseTaskFile,
  summarizeTasks,
} from './status-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_STRICT_FROM = 230;

/** 從此任務號起，額外要求 plan_ref / acceptance_evidence / blocked_by schema。 */
export const DEFAULT_SCHEMA_FROM = 250;

const PLAN_REF_PATTERN = /^(?:M[0-5]|[A-Z]{2,4}-\d{2})$/;
const ACCEPTANCE_EVIDENCE_PATTERN = /^tasks\/evidence\/T\d+.*\.md$/;
const BLOCKER_PATTERN = /^(?:T\d{3}|DEC-0[1-9]|M[0-5]|needs-human)$/;

/** 舊任務只警告；strict 任務才阻擋。 */
export function isLegacyTask(task, strictFrom = DEFAULT_STRICT_FROM) {
  const enforcement = task.meta?.enforcement;
  if (enforcement === 'legacy') return true;
  if (enforcement === 'strict') return false;
  return Number(task.number) < Number(strictFrom);
}

function fileIdOf(fileName = '') {
  return String(fileName).match(/^(T\d+)/)?.[1] || '';
}

/** 檔名 T116 可對應 task_id: T116-T119；其他情況要求完全一致。 */
export function taskIdCoversFileId(taskId, fileId) {
  if (!taskId || !fileId) return true;
  const range = String(taskId).match(/^(T\d+)\s*-\s*(T\d+)$/i);
  if (!range) return String(taskId).toUpperCase() === String(fileId).toUpperCase();
  const start = Number(range[1].slice(1));
  const end = Number(range[2].slice(1));
  const value = Number(String(fileId).slice(1));
  return value >= Math.min(start, end) && value <= Math.max(start, end);
}

/** 與 status-core 的 INDEX 判定保持一致：完整路徑、./ 相對路徑或檔名皆可。 */
export function isHandoffRegistered(handoff, docsIndex) {
  if (!handoff || !docsIndex) return false;
  const relative = handoff.replace(/^docs\//, './');
  const fileName = handoff.split('/').pop();
  return (
    docsIndex.includes(handoff) || docsIndex.includes(relative) || docsIndex.includes(fileName)
  );
}

function issue(level, code, task, message) {
  return {
    level,
    code,
    taskId: task.id || fileIdOf(task.fileName) || '?',
    file: task.file || `tasks/${task.fileName || ''}`,
    message,
  };
}

/**
 * 純函式：不讀檔、不跑 git。task 需含 file/fileName/id/number/meta，
 * 並可用 hasFrontMatter=false 表示檔案沒有 front matter。
 */
export function analyzeTasks(tasks, options = {}) {
  const {
    strictFrom = DEFAULT_STRICT_FROM,
    schemaFrom = DEFAULT_SCHEMA_FROM,
    integrationRef = 'origin/develop',
    isAncestor = () => null,
    pathExists = () => false,
    docsIndex = '',
  } = options;

  const issues = [];
  const items = tasks.map((task) => {
    const enriched = classifyTask(task, {
      legacyBefore: strictFrom,
      integrationRef,
      isAncestor,
      pathExists,
      docsIndex,
    });
    return {
      ...enriched,
      strict: !isLegacyTask(task, strictFrom),
    };
  });

  const byId = new Map();
  for (const item of items) {
    if (!byId.has(item.id)) byId.set(item.id, []);
    byId.get(item.id).push(item);
  }
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    const level = group.some((item) => item.strict) ? 'error' : 'warning';
    const files = group.map((item) => item.fileName).join(', ');
    for (const item of group) {
      issues.push(issue(level, 'duplicate-task-id', item, `任務 ID ${id} 重複：${files}`));
    }
  }

  for (const item of items) {
    const level = item.strict ? 'error' : 'warning';
    const meta = item.meta || {};
    const hasFrontMatter = item.hasFrontMatter !== false;

    if (!hasFrontMatter) {
      issues.push(issue(level, 'missing-front-matter', item, '缺少 YAML front matter'));
    } else {
      const rawStatus = meta.execution_status ?? meta.status;
      if (!rawStatus) {
        issues.push(issue(level, 'missing-status', item, '缺少 status / execution_status'));
      } else if (normalizeStatus(rawStatus) === 'unknown') {
        issues.push(
          issue(level, 'invalid-status', item, `無法辨識 status: ${String(rawStatus)}`),
        );
      }

      if (!meta.stage && !meta.stage_id) {
        issues.push(issue(level, 'missing-stage', item, '缺少 stage / stage_id'));
      }
    }

    if (meta.task_id && !taskIdCoversFileId(meta.task_id, fileIdOf(item.fileName))) {
      issues.push(
        issue(
          level,
          'task-id-mismatch',
          item,
          `task_id (${meta.task_id}) 與檔名 (${item.fileName}) 不一致`,
        ),
      );
    }

    const status = normalizeStatus(meta.execution_status ?? meta.status);
    const schemaStrict = Number(item.number) >= Number(schemaFrom);

    if (schemaStrict) {
      const planRef = String(meta.plan_ref || '').trim();
      if (!planRef) {
        issues.push(issue(level, 'missing-plan-ref', item, '缺少 plan_ref（M0–M5 或 SEC-01 這類計劃編號）'));
      } else if (!PLAN_REF_PATTERN.test(planRef)) {
        issues.push(
          issue(level, 'invalid-plan-ref', item, `plan_ref 格式不合法：${planRef}`),
        );
      }

      const evidencePath = String(meta.acceptance_evidence || '').trim();
      if (!evidencePath) {
        issues.push(
          issue(level, 'missing-acceptance-evidence', item, '缺少 acceptance_evidence（tasks/evidence/T*.md）'),
        );
      } else if (!ACCEPTANCE_EVIDENCE_PATTERN.test(evidencePath)) {
        issues.push(
          issue(
            level,
            'invalid-acceptance-evidence',
            item,
            `acceptance_evidence 必須是 tasks/evidence/T*.md：${evidencePath}`,
          ),
        );
      } else if (status === 'completed' && !pathExists(evidencePath)) {
        issues.push(
          issue(level, 'missing-acceptance-evidence', item, `acceptance_evidence 檔案不存在：${evidencePath}`),
        );
      }

      const blockedBy = parseBlockedBy(meta);
      for (const token of blockedBy) {
        if (!BLOCKER_PATTERN.test(token)) {
          issues.push(
            issue(
              level,
              'invalid-blocked-by',
              item,
              `blocked_by 只允許 T\\d{3}、DEC-0[1-9]、M[0-5]、needs-human：${token}`,
            ),
          );
        }
      }
      if (status === 'completed' && blockedBy.length) {
        issues.push(
          issue(level, 'completed-with-blockers', item, `completed 但仍有 blocked_by：${blockedBy.join(', ')}`),
        );
      }
    }

    if (status !== 'completed') continue;

    const mergeCommitOk = meta.merge_commit
      ? isAncestor(meta.merge_commit, integrationRef) === true
      : false;
    const branchOk = meta.branch
      ? isAncestor(meta.branch, integrationRef) === true
      : false;
    const evidence = [meta.merge_commit && `merge_commit=${meta.merge_commit}`, meta.branch && `branch=${meta.branch}`]
      .filter(Boolean)
      .join(' / ');

    if (!mergeCommitOk && !branchOk) {
      issues.push(
        issue(
          level,
          'missing-merge-evidence',
          item,
          `completed 但沒有可驗證的 merge 證據（${evidence || '無 merge_commit/branch'} 不是 ${integrationRef} 的祖先）`,
        ),
      );
    }

    const handoff = meta.handoff || '';
    if (!handoff) {
      issues.push(issue(level, 'missing-handoff', item, 'completed 但缺少 handoff 欄位'));
    } else if (!pathExists(handoff)) {
      issues.push(
        issue(level, 'missing-handoff', item, `completed 但 handoff 檔案不存在：${handoff}`),
      );
    } else if (!isHandoffRegistered(handoff, docsIndex)) {
      issues.push(
        issue(
          level,
          'unregistered-handoff',
          item,
          `handoff 未登記在 docs/INDEX.md：${handoff}`,
        ),
      );
    }
  }

  const summary = summarizeTasks(tasks, {
    legacyBefore: strictFrom,
    integrationRef,
    isAncestor,
    pathExists,
    docsIndex,
  });
  const errors = issues.filter((item) => item.level === 'error');
  const warnings = issues.filter((item) => item.level === 'warning');

  return {
    strictFrom,
    schemaFrom,
    integrationRef,
    counts: {
      total: items.length,
      strict: items.filter((item) => item.strict).length,
      legacy: items.filter((item) => !item.strict).length,
      errors: errors.length,
      warnings: warnings.length,
    },
    ok: errors.length === 0,
    tasks: items,
    issues,
    errors,
    warnings,
    summary,
  };
}

function parseArgs(argv) {
  const args = {
    strictFrom: DEFAULT_STRICT_FROM,
    schemaFrom: DEFAULT_SCHEMA_FROM,
    report: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') {
      args.report = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--strict-from') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--strict-from 需要一個數字');
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0) {
        throw new Error(`--strict-from 必須是非負整數: ${value}`);
      }
      args.strictFrom = number;
      index += 1;
    } else if (arg === '--schema-from') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--schema-from 需要一個數字');
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0) {
        throw new Error(`--schema-from 必須是非負整數: ${value}`);
      }
      args.schemaFrom = number;
      index += 1;
    } else {
      throw new Error(`未知參數: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`用法: node scripts/task-check.mjs [選項]

檢查 tasks/T*.md 的 front matter、任務 ID 與 strict 任務的 merge/handoff/INDEX 證據。

選項:
  --strict-from <n>  從哪個任務號開始視為 strict（預設 ${DEFAULT_STRICT_FROM}）
  --schema-from <n>  從哪個任務號開始要求 plan_ref/acceptance_evidence（預設 ${DEFAULT_SCHEMA_FROM}）
  --report           只報告，不論違規都不 exit 1
  --json             以 JSON 輸出完整結果
  -h, --help         顯示說明
`);
}

function gitText(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function resolveRef(ref) {
  if (!ref) return null;
  const candidates = [ref];
  if (!ref.startsWith('origin/')) candidates.push(`origin/${ref}`);
  if (!ref.startsWith('refs/')) candidates.push(`refs/heads/${ref}`);
  return (
    candidates.find(
      (candidate) => gitText(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]) !== '',
    ) || null
  );
}

function createAncestorCheck() {
  const cache = new Map();
  return (ref, base) => {
    const key = `${ref}\u0000${base}`;
    if (cache.has(key)) return cache.get(key);
    const resolvedRef = resolveRef(ref);
    const resolvedBase = resolveRef(base);
    if (!resolvedRef || !resolvedBase) {
      cache.set(key, null);
      return null;
    }
    const result = spawnSync('git', ['merge-base', '--is-ancestor', resolvedRef, resolvedBase], {
      cwd: repoRoot,
    });
    const value = result.status === 0 ? true : result.status === 1 ? false : null;
    cache.set(key, value);
    return value;
  };
}

function pickIntegrationRef() {
  for (const candidate of ['origin/develop', 'develop']) {
    if (resolveRef(candidate)) return candidate;
  }
  return 'origin/develop';
}

function readTasks() {
  const directory = path.join(repoRoot, 'tasks');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((fileName) => /^T\d+.*\.md$/.test(fileName))
    .map((fileName) => {
      const text = fs.readFileSync(path.join(directory, fileName), 'utf8');
      return {
        ...parseTaskFile(fileName, text),
        hasFrontMatter: parseFrontMatter(text) !== null,
      };
    })
    .sort(
      (a, b) =>
        a.number - b.number || (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0),
    );
}

function readText(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

function printIssues(label, issues, limit = 20) {
  console.log(`${label}: ${issues.length}`);
  for (const item of issues.slice(0, limit)) {
    console.log(`  - [${item.code}] ${item.taskId} (${item.file}): ${item.message}`);
  }
  if (issues.length > limit) {
    console.log(`  ... 另有 ${issues.length - limit} 筆，使用 --json 查看完整清單`);
  }
}

function printHuman(result, report) {
  console.log(
    `任務書檢查：strict 門檻 T${result.strictFrom}，schema 門檻 T${result.schemaFrom}，integration=${result.integrationRef}`,
  );
  console.log(
    `任務 ${result.counts.total} 筆（strict ${result.counts.strict} / legacy ${result.counts.legacy}）；` +
      `errors ${result.counts.errors} / warnings ${result.counts.warnings}`,
  );
  if (result.errors.length) printIssues('Errors', result.errors, 50);
  if (result.warnings.length) printIssues('Warnings', result.warnings, 20);
  if (report && result.errors.length) {
    console.log('（--report：只報告，不因 strict violations 回傳失敗）');
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const tasks = readTasks();
  const integrationRef = pickIntegrationRef();
  const result = analyzeTasks(tasks, {
    strictFrom: args.strictFrom,
    schemaFrom: args.schemaFrom,
    integrationRef,
    isAncestor: createAncestorCheck(),
    pathExists: (relativePath) => fs.existsSync(path.join(repoRoot, relativePath)),
    docsIndex: readText('docs/INDEX.md'),
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result, args.report);
  }

  if (result.errors.length > 0 && !args.report) {
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    // --report 只抑制「strict violation」；非預期錯誤仍然要讓 CI 看見。
    process.exitCode = 1;
  }
}
