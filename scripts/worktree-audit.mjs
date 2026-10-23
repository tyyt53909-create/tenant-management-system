#!/usr/bin/env node

/**
 * Worktree 唯讀稽核：只跑 git worktree list / status / rev-list，不刪除、不修改任何 worktree。
 *
 * 用法:
 *   node scripts/worktree-audit.mjs
 *   node scripts/worktree-audit.mjs --check
 *   node scripts/worktree-audit.mjs --json
 *   node scripts/worktree-audit.mjs --max-active 4 --stale-days 7
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeStatus, parseTaskFile } from './status-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MAX_ACTIVE = 4;
export const DEFAULT_STALE_DAYS = 7;

/** 解析 `git worktree list --porcelain`，保留主要 worktree 為第一筆。 */
export function parseWorktreePorcelain(text) {
  const worktrees = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    worktrees.push({
      ...current,
      branch: current.branch || null,
      detached: Boolean(current.detached || !current.branch),
      isMain: worktrees.length === 0,
    });
    current = null;
  };

  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    const separator = line.indexOf(' ');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);

    if (key === 'worktree') {
      flush();
      current = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
    } else if (current) {
      if (key === 'HEAD') current.head = value;
      else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'detached') current.detached = true;
      else if (key === 'bare') current.bare = true;
      else if (key === 'locked') current.locked = true;
      else if (key === 'prunable') current.prunable = true;
    }
  }
  flush();
  return worktrees;
}

/** 從 branch 或 worktree 路徑尾段取任務編號，例如 feature/T230-room-photos -> T230。 */
export function taskIdFromRef(value) {
  const matches = [...String(value || '').matchAll(/(?:^|[\/_\-\s])(T\d{3})(?=$|[\/_\-\s])/gi)];
  const last = matches[matches.length - 1];
  return last ? last[1].toUpperCase() : null;
}

export function taskIdFromWorktree(worktree) {
  return taskIdFromRef(worktree.branch) || taskIdFromRef(path.basename(worktree.path || ''));
}

/**
 * 純函式：worktree 每筆可帶 dirtyFiles / ahead / behind / lastCommitAt / isMain。
 * ahead 是 branch 傾斜 integration 的提交數；ahead === 0 視為已合併。
 */
export function auditWorktrees(worktrees, options = {}) {
  const {
    maxActive = DEFAULT_MAX_ACTIVE,
    staleDays = DEFAULT_STALE_DAYS,
    now = Date.now(),
    completedTaskIds = new Set(),
    integrationRef = 'origin/develop',
  } = options;
  const staleMs = Number(staleDays) * DAY_MS;
  const violations = [];

  const items = worktrees.map((raw, index) => {
    const isMain = raw.isMain ?? index === 0;
    const branch = raw.branch || null;
    const dirtyFiles = Number.isFinite(raw.dirtyFiles) ? raw.dirtyFiles : null;
    const ahead = Number.isFinite(raw.ahead) ? raw.ahead : null;
    const behind = Number.isFinite(raw.behind) ? raw.behind : null;
    const lastCommitAt = Number.isFinite(raw.lastCommitAt) ? raw.lastCommitAt : null;
    const taskId = raw.taskId ?? taskIdFromWorktree({ branch, path: raw.path });
    const merged = branch ? (ahead === null ? null : ahead === 0) : null;
    const stale = !isMain && lastCommitAt !== null && now - lastCommitAt > staleMs;
    const active = !isMain && !stale && merged !== true;
    const completedTask = Boolean(taskId && completedTaskIds.has(taskId));

    const item = {
      ...raw,
      isMain,
      branch,
      detached: Boolean(raw.detached || !branch),
      taskId,
      dirtyFiles,
      ahead,
      behind,
      lastCommitAt,
      merged,
      stale,
      active,
      completedTask,
      issues: [],
    };

    const add = (code, message) => {
      const violation = {
        code,
        worktree: item.path,
        branch,
        taskId,
        message,
      };
      item.issues.push(violation);
      violations.push(violation);
    };

    if (dirtyFiles !== null && dirtyFiles > 0) {
      add('dirty-worktree', `有 ${dirtyFiles} 個未提交檔案`);
    }
    if (item.detached) {
      add('detached-head', 'HEAD 處於 detached 狀態');
    }
    if (!isMain && merged === true) {
      add('merged-worktree', `branch 已合併進 ${integrationRef}，worktree 仍存在`);
    }
    if (completedTask) {
      add('completed-task-worktree', `任務 ${taskId} 已完成，worktree 仍存在`);
    }
    if (stale) {
      add('stale-worktree', `超過 ${staleDays} 天沒有新提交`);
    }

    return item;
  });

  const activeCount = items.filter((item) => item.active).length;
  if (activeCount > maxActive) {
    violations.push({
      code: 'too-many-active',
      worktree: null,
      branch: null,
      taskId: null,
      message: `active worktree ${activeCount} 個，超過上限 ${maxActive}`,
    });
  }

  return {
    integrationRef,
    counts: {
      total: items.length,
      active: activeCount,
      dirty: items.filter((item) => (item.dirtyFiles || 0) > 0).length,
      detached: items.filter((item) => item.detached).length,
      merged: items.filter((item) => !item.isMain && item.merged === true).length,
      stale: items.filter((item) => item.stale).length,
      completedTasks: items.filter((item) => item.completedTask).length,
      violations: violations.length,
    },
    maxActive,
    staleDays,
    ok: violations.length === 0,
    worktrees: items,
    violations,
  };
}

function parsePositiveInteger(value, flag, allowZero = false) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new Error(`${flag} 必須是${allowZero ? '非負' : '正'}整數: ${value}`);
  }
  return number;
}

function parseArgs(argv) {
  const args = {
    json: false,
    check: false,
    help: false,
    maxActive: DEFAULT_MAX_ACTIVE,
    staleDays: DEFAULT_STALE_DAYS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--max-active' || arg === '--stale-days') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要一個數字`);
      if (arg === '--max-active') args.maxActive = parsePositiveInteger(value, arg, true);
      else args.staleDays = parsePositiveInteger(value, arg);
      index += 1;
    } else {
      throw new Error(`未知參數: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`用法: node scripts/worktree-audit.mjs [選項]

唯讀稽核 worktree（dirty、detached、已合併、已完成任務、stale、active 數量）。
本工具不會刪除或修改任何 worktree。

選項:
  --json             以 JSON 輸出完整結果
  --check            有違規時 exit 1
  --max-active <n>   active worktree 上限（預設 ${DEFAULT_MAX_ACTIVE}）
  --stale-days <n>   幾天沒有新提交視為 stale（預設 ${DEFAULT_STALE_DAYS}）
  -h, --help         顯示說明
`);
}

function gitText(args, cwd = repoRoot) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
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

function pickIntegrationRef() {
  for (const candidate of ['origin/develop', 'develop', 'origin/main', 'main']) {
    if (resolveRef(candidate)) return candidate;
  }
  return 'origin/develop';
}

function countDirtyFiles(worktreePath) {
  if (!fs.existsSync(worktreePath)) return null;
  const output = gitText(['status', '--porcelain=v1', '--untracked-files=all'], worktreePath);
  return output ? output.split('\n').filter((line) => line.trim()).length : 0;
}

function lastCommitTime(worktreePath) {
  if (!fs.existsSync(worktreePath)) return null;
  const output = gitText(['log', '-1', '--format=%ct'], worktreePath);
  const value = Number(output);
  return Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

function aheadBehind(worktreePath, branch, integrationRef) {
  if (!branch || !integrationRef) return { ahead: null, behind: null };
  const output = gitText(
    ['rev-list', '--left-right', '--count', `${integrationRef}...${branch}`],
    worktreePath,
  );
  const match = output.match(/^(\d+)\s+(\d+)$/);
  if (!match) return { ahead: null, behind: null };
  return { ahead: Number(match[2]), behind: Number(match[1]) };
}

function readCompletedTaskIds() {
  const directory = path.join(repoRoot, 'tasks');
  const ids = new Set();
  if (!fs.existsSync(directory)) return ids;
  for (const fileName of fs.readdirSync(directory).filter((name) => /^T\d+.*\.md$/.test(name))) {
    const text = fs.readFileSync(path.join(directory, fileName), 'utf8');
    const task = parseTaskFile(fileName, text);
    if (normalizeStatus(task.meta.execution_status ?? task.meta.status) !== 'completed') continue;
    if (task.id) ids.add(task.id);
    if (task.number) ids.add(`T${String(task.number).padStart(3, '0')}`);
  }
  return ids;
}

function printHuman(result) {
  const { counts } = result;
  console.log(`Worktree 稽核：total ${counts.total} / active ${counts.active}（上限 ${result.maxActive}）`);
  console.log(
    `dirty ${counts.dirty} / detached ${counts.detached} / merged ${counts.merged} / ` +
      `stale ${counts.stale} / completed-task ${counts.completedTasks}`,
  );
  console.log('');
  for (const item of result.worktrees) {
    const flags = [
      item.isMain ? 'main' : 'linked',
      item.taskId || 'no-task',
      item.branch || 'detached',
      item.dirtyFiles === null ? 'dirty=?' : `dirty=${item.dirtyFiles}`,
      item.ahead === null ? 'ahead=?' : `ahead=${item.ahead}`,
      item.stale ? 'stale' : null,
      item.active ? 'active' : null,
    ]
      .filter(Boolean)
      .join(' | ');
    console.log(`  ${item.path}`);
    console.log(`    ${flags}`);
  }
  console.log('');
  if (!result.violations.length) {
    console.log('Violations: 0');
    return;
  }
  console.log(`Violations: ${result.violations.length}`);
  for (const item of result.violations) {
    console.log(`  - [${item.code}] ${item.worktree || '-'}: ${item.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const listText = gitText(['worktree', 'list', '--porcelain']);
  if (!listText) throw new Error('git worktree list --porcelain 沒有輸出');

  const integrationRef = pickIntegrationRef();
  const completedTaskIds = readCompletedTaskIds();
  const worktrees = parseWorktreePorcelain(listText).map((item) => {
    const { ahead, behind } = aheadBehind(item.path, item.branch, integrationRef);
    return {
      ...item,
      dirtyFiles: countDirtyFiles(item.path),
      lastCommitAt: lastCommitTime(item.path),
      ahead,
      behind,
    };
  });

  const result = auditWorktrees(worktrees, {
    maxActive: args.maxActive,
    staleDays: args.staleDays,
    now: Date.now(),
    completedTaskIds,
    integrationRef,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  if (args.check && result.violations.length > 0) {
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
    process.exitCode = 1;
  }
}
