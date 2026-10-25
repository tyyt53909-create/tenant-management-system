/**
 * Gate 收集器：實際執行 lint / test / build / openapi / docs，並回傳結構化結果。
 *
 * 這個模組只負責「取得證據」，不決定看板要長什麼樣。
 * generate-status.mjs 與 collect-gates.mjs 都共用同一套 gate 定義與解析邏輯。
 */

import path from 'node:path';
import { execSync } from 'node:child_process';
import { DEFAULT_GATES } from './status-core.mjs';

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(value) {
  return String(value || '').replace(ANSI_PATTERN, '');
}

function readVitestSummary(output, label) {
  const line = stripAnsi(output)
    .split('\n')
    .find((row) => new RegExp(`^\\s*${label}\\s`).test(row));
  return {
    passed: Number(line?.match(/(\d+)\s+passed/)?.[1] ?? 0),
    failed: Number(line?.match(/(\d+)\s+failed/)?.[1] ?? 0),
  };
}

export function parseVitest(output) {
  const files = readVitestSummary(output, 'Test Files');
  const tests = readVitestSummary(output, 'Tests');
  const failed = files.failed + tests.failed;
  const hasSummary = files.passed + files.failed + tests.passed + tests.failed > 0;
  const failureParts = [];
  if (tests.failed) failureParts.push(`${tests.failed} tests`);
  if (files.failed) failureParts.push(`${files.failed} files`);
  const failure = failureParts.length ? `（${failureParts.join(' / ')} failed）` : '';
  return {
    counts: { files: files.passed, tests: tests.passed, failed },
    evidence: hasSummary ? `${files.passed} files / ${tests.passed} tests${failure}` : '',
  };
}

/** 相容 Node 20 的 `ℹ pass` 與 Node 22 的 `# pass` TAP 摘要。 */
export function parseNodeTest(output) {
  const clean = stripAnsi(output);
  const pass = clean.match(/(?:ℹ|#)\s*pass (\d+)/);
  const fail = clean.match(/(?:ℹ|#)\s*fail (\d+)/);
  const tests = Number(pass?.[1] ?? 0);
  const failed = Number(fail?.[1] ?? 0);
  return {
    counts: { tests, failed },
    evidence: pass ? `${tests} tests${failed ? `（${failed} failed）` : ''}` : '',
  };
}

export function parseLint(output) {
  const match = stripAnsi(output).match(/Found\s+(\d+)\s+warnings?\s+and\s+(\d+)\s+errors?/i);
  if (!match) return { counts: { warnings: 0, errors: 0 }, evidence: 'exit 0' };
  return {
    counts: { warnings: Number(match[1]), errors: Number(match[2]) },
    evidence: `${match[1]} warnings / ${match[2]} errors`,
  };
}

function lastLine(output) {
  return (
    stripAnsi(output)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() || ''
  );
}

const COMMANDS = {
  'backend-lint': {
    cwd: 'backend',
    command: 'npm run lint',
    parse: parseLint,
  },
  'backend-tsc': {
    cwd: 'backend',
    command: 'npx tsc -p tsconfig.typecheck.json --noEmit',
  },
  'backend-unit': {
    cwd: 'backend',
    command: 'npm test',
    parse: parseVitest,
  },
  'backend-e2e': {
    cwd: 'backend',
    command: 'npm run test:e2e',
    parse: parseVitest,
  },
  // T316：test:int 不再读取 DATABASE_URL。缺少标记或 ALLOW_INTEGRATION_RESET 时失败，不得改成跳过。
  integration: {
    cwd: 'backend',
    command: 'npm run test:int',
    parse: parseVitest,
  },
  'frontend-lint': {
    cwd: 'frontend-admin',
    command: 'npm run lint',
    parse: parseLint,
  },
  'frontend-unit': {
    cwd: 'frontend-admin',
    command: 'npm test',
    parse: parseVitest,
  },
  'frontend-build': {
    cwd: 'frontend-admin',
    command: 'npm run build',
  },
  'miniprogram-unit': {
    cwd: 'miniprogram',
    command: 'npm test',
    parse: parseNodeTest,
  },
  'miniprogram-build': {
    cwd: 'miniprogram',
    command: 'npm run build:mp-weixin',
    env: { VITE_API_BASE_URL: 'https://api.example.test/api' },
  },
  openapi: {
    cwd: 'backend',
    command: 'npm run openapi:check',
  },
  docs: {
    cwd: '.',
    command: 'node scripts/check-docs.js',
    missingDependency: (output) => output.includes("Cannot find module 'glob'"),
  },
};

const NOT_RUN_EVIDENCE = {
  integration: 'T231 尚未提供可執行套件',
  security: '尚無 CI artifact',
  'manual-uat': '尚無驗收紀錄',
};

function runGate({ definition, config, repoRoot, env }) {
  const startedAt = Date.now();
  const cwd = path.join(repoRoot, config.cwd || '.');
  try {
    const output = execSync(`${config.command} 2>&1`, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
      env: { ...env, ...config.env },
    });
    const parsed = config.parse?.(output) || {};
    return {
      id: definition.id,
      label: definition.label,
      status: 'pass',
      evidence: parsed.evidence || 'exit 0',
      counts: parsed.counts,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (config.missingDependency?.(output)) {
      return {
        id: definition.id,
        label: definition.label,
        status: 'not-run',
        evidence: '缺少本機依賴（CI 會安裝）',
        durationMs: Date.now() - startedAt,
      };
    }
    const parsed = config.parse?.(output) || {};
    return {
      id: definition.id,
      label: definition.label,
      status: 'fail',
      evidence: parsed.evidence || lastLine(output) || `exit ${error.status ?? 1}`,
      counts: parsed.counts,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * 依 DEFAULT_GATES 的順序回傳所有 gate。
 * - 有 COMMANDS 的 gate 會實際執行。
 * - 沒有 COMMANDS 的 gate（integration/security/manual-uat）標記為 not-run。
 */
export function collectGates({ repoRoot, env = process.env, log } = {}) {
  if (!repoRoot) throw new Error('collectGates 需要 repoRoot');
  return DEFAULT_GATES.map((definition) => {
    const config = COMMANDS[definition.id];
    if (!config) {
      return {
        id: definition.id,
        label: definition.label,
        status: 'not-run',
        evidence: NOT_RUN_EVIDENCE[definition.id] || '未提供',
      };
    }
    log?.(definition.id);
    return runGate({ definition, config, repoRoot, env });
  });
}
