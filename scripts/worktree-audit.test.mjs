import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditWorktrees,
  parseWorktreePorcelain,
  taskIdFromRef,
  taskIdFromWorktree,
} from './worktree-audit.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-23T00:00:00Z');
const FRESH = NOW - 2 * DAY_MS;
const STALE = NOW - 10 * DAY_MS;

function worktree(worktreePath, overrides = {}) {
  return {
    path: worktreePath,
    branch: 'feature/T230-room-photos',
    head: 'abc1234',
    detached: false,
    isMain: false,
    dirtyFiles: 0,
    ahead: 1,
    behind: 0,
    lastCommitAt: FRESH,
    ...overrides,
  };
}

function codes(result) {
  return result.violations.map((item) => item.code);
}

test('parseWorktreePorcelain 解析 main、branch 與 detached', () => {
  const parsed = parseWorktreePorcelain(`worktree /repo
HEAD aaaaaaa
branch refs/heads/develop

worktree /repo/worktrees/T230
HEAD bbbbbbb
branch refs/heads/feature/T230-room-photos

worktree /repo/worktrees/old
HEAD ccccccc
detached
`);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].path, '/repo');
  assert.equal(parsed[0].branch, 'develop');
  assert.equal(parsed[0].isMain, true);
  assert.equal(parsed[1].branch, 'feature/T230-room-photos');
  assert.equal(parsed[1].detached, false);
  assert.equal(parsed[2].detached, true);
  assert.equal(parsed[2].isMain, false);
});

test('taskIdFromRef 從 branch 與路徑尾段映射任務編號', () => {
  assert.equal(taskIdFromRef('feature/T230-room-photos'), 'T230');
  assert.equal(taskIdFromRef('chore/T232-board-docs-calibration'), 'T232');
  assert.equal(taskIdFromRef('docs/reliability-task-plan'), null);
  assert.equal(taskIdFromWorktree({ branch: null, path: '/repo/worktrees/T229-sales-sandbox' }), 'T229');
});

test('dirty、detached 與 completed-task worktree 都會回報', () => {
  const result = auditWorktrees(
    [
      worktree('/repo', { isMain: true, dirtyFiles: 3 }),
      worktree('/repo/worktrees/detached', {
        branch: null,
        detached: true,
        ahead: null,
        lastCommitAt: FRESH,
      }),
    ],
    { now: NOW, maxActive: 4, completedTaskIds: new Set(['T230']) },
  );

  assert.equal(result.counts.dirty, 1);
  assert.equal(result.counts.detached, 1);
  assert.equal(result.counts.completedTasks, 1);
  assert.equal(codes(result).includes('dirty-worktree'), true);
  assert.equal(codes(result).includes('detached-head'), true);
  assert.equal(codes(result).includes('completed-task-worktree'), true);
});

test('stale worktree 不計入 active', () => {
  const result = auditWorktrees(
    [
      worktree('/repo/worktrees/old', {
        branch: 'feature/T100-old',
        ahead: 5,
        lastCommitAt: STALE,
      }),
    ],
    { now: NOW, staleDays: 7, maxActive: 4 },
  );

  const item = result.worktrees[0];
  assert.equal(item.stale, true);
  assert.equal(item.active, false);
  assert.equal(codes(result).includes('stale-worktree'), true);
});

test('已合併 branch 仍 checked out 會回報且不計入 active', () => {
  const result = auditWorktrees(
    [worktree('/repo/worktrees/T229', { branch: 'feature/T229-sales-sandbox', ahead: 0 })],
    { now: NOW, integrationRef: 'origin/develop', maxActive: 4 },
  );

  const item = result.worktrees[0];
  assert.equal(item.merged, true);
  assert.equal(item.active, false);
  assert.equal(codes(result).includes('merged-worktree'), true);
});

test('active worktree 超過上限才回報 too-many-active', () => {
  const active = Array.from({ length: 5 }, (_, index) =>
    worktree(`/repo/worktrees/T23${index}`, {
      branch: `feature/T23${index}-task`,
      ahead: 1,
      lastCommitAt: FRESH,
    }),
  );
  const over = auditWorktrees([worktree('/repo', { isMain: true }), ...active], {
    now: NOW,
    maxActive: 4,
  });
  assert.equal(over.counts.active, 5);
  assert.equal(codes(over).includes('too-many-active'), true);

  const within = auditWorktrees(active.slice(0, 4), { now: NOW, maxActive: 4 });
  assert.equal(within.counts.active, 4);
  assert.equal(codes(within).includes('too-many-active'), false);
});

test('乾淨、未合併的 linked worktree 沒有違規', () => {
  const result = auditWorktrees(
    [
      worktree('/repo', {
        isMain: true,
        branch: 'develop',
        ahead: 0,
        lastCommitAt: FRESH,
      }),
      worktree('/repo/worktrees/T231', {
        branch: 'feature/T231-integration-foundation',
        ahead: 2,
        lastCommitAt: FRESH,
      }),
    ],
    { now: NOW, maxActive: 4 },
  );

  assert.equal(result.violations.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.worktrees[0].active, false);
  assert.equal(result.worktrees[1].active, true);
});
