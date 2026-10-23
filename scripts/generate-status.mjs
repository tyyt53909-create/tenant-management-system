#!/usr/bin/env node

/**
 * STATUS.md 生成器（證據版）。
 *
 * 與舊版的差別：
 * - 不再把階段進度硬編碼成 100%，也不再用「最大任務號」代表全部完成。
 * - 任務狀態從 tasks/*.md 的 front matter 讀取，並用 merge / handoff 證據分類。
 * - Gate 失敗時照樣產出 NO-GO 看板，不再拒絕渲染。
 * - 支援 --check：CI 可比對 committed STATUS.md 是否與生成結果一致。
 *
 * 用法:
 *   node scripts/generate-status.mjs
 *   node scripts/generate-status.mjs --check
 *   node scripts/generate-status.mjs --output /tmp/STATUS.md
 *   node scripts/generate-status.mjs --gates artifacts/gates.json
 *   node scripts/generate-status.mjs --no-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectGates } from './gates.mjs';
import {
  DEFAULT_LEGACY_BEFORE,
  checkStatusSemantics,
  computeReadiness,
  normalizeGates,
  parseTaskFile,
  renderStatus,
  summarizeTasks,
} from './status-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const statusPath = path.join(repoRoot, 'STATUS.md');

function parseArgs(argv) {
  const args = {
    check: false,
    checkGates: false,
    noRun: false,
    help: false,
    output: null,
    gates: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      args.check = true;
    } else if (arg === '--check-gates') {
      args.checkGates = true;
    } else if (arg === '--no-run') {
      args.noRun = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--output' || arg === '--gates') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要一個值`);
      args[arg.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`未知參數: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`用法: node scripts/generate-status.mjs [選項]

選項:
  --check           只比對 STATUS.md，不一致時 exit 1（byte-level，適合本機）
  --check-gates     只比對 Gate/任務摘要，不比較證據與環境欄位（適合 CI）
  --output <path>   輸出到指定路徑（預設 STATUS.md）
  --gates <path>    讀取既有的 gates JSON，不重新執行測試
  --no-run          不執行任何 gate，全部標記為 not-run
  -h, --help        顯示說明
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

function isAncestor(ref, base) {
  const resolvedRef = resolveRef(ref);
  const resolvedBase = resolveRef(base);
  if (!resolvedRef || !resolvedBase) return null;
  const result = spawnSync('git', ['merge-base', '--is-ancestor', resolvedRef, resolvedBase], {
    cwd: repoRoot,
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
}

function pickIntegrationRef() {
  const candidates = ['origin/develop', 'develop', 'origin/main', 'main'];
  return (
    candidates.find(
      (candidate) => gitText(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]) !== '',
    ) || 'develop'
  );
}

function countDirtyFiles() {
  const output = gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  // STATUS.md 是生成物；排除它，否則「先產生再提交」永遠會被自己算成 dirty。
  return output
    ? output.split('\n').filter((line) => line.trim() && !line.endsWith('STATUS.md')).length
    : 0;
}

function readText(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

function readTasks() {
  const directory = path.join(repoRoot, 'tasks');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((fileName) => /^T\d+.*\.md$/.test(fileName))
    .map((fileName) => parseTaskFile(fileName, fs.readFileSync(path.join(directory, fileName), 'utf8')))
    .sort((a, b) => a.number - b.number || (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
}

function readRecentHandoffs(limit = 8) {
  const directory = path.join(repoRoot, 'docs/handoff');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, limit)
    .map((fileName) => {
      const text = fs.readFileSync(path.join(directory, fileName), 'utf8');
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || fileName.replace(/\.md$/, '');
      return { title, path: `docs/handoff/${fileName}` };
    });
}

function getLineCount(command) {
  try {
    const output = execSync(command, { cwd: repoRoot, encoding: 'utf8' }).trim();
    const lines = output.split('\n');
    const last = lines[lines.length - 1].trim();
    const match = last.match(/^(\d+)/);
    return match ? Number.parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

function readMetrics() {
  const schemaPath = path.join(repoRoot, 'backend/prisma/schema.prisma');
  const schema = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : '';
  const modelCount = (schema.match(/^model\s+\w+/gm) || []).length;

  let routeCount = 0;
  const openapiPath = path.join(repoRoot, 'backend/openapi.json');
  if (fs.existsSync(openapiPath)) {
    try {
      const spec = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
      const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
      for (const pathItem of Object.values(spec.paths || {})) {
        for (const method of Object.keys(pathItem)) {
          if (methods.has(method.toLowerCase())) routeCount += 1;
        }
      }
    } catch {
      routeCount = 0;
    }
  }

  return {
    modelCount,
    routeCount,
    backendLines: getLineCount("find backend/src -name '*.ts' ! -name '*.spec.ts' | xargs wc -l"),
    frontendLines: getLineCount(
      "find frontend-admin/src -type f \\( -name '*.ts' -o -name '*.vue' \\) | xargs wc -l",
    ),
    miniprogramLines: getLineCount(
      "find miniprogram -type f \\( -name '*.js' -o -name '*.vue' -o -name '*.ts' -o -name '*.json' \\) ! -path '*/node_modules/*' ! -path '*/dist/*' ! -name 'package-lock.json' | xargs wc -l",
    ),
    docCount: getLineCount(
      "find docs -name '*.md' ! -path '*/archive/*' ! -name 'INDEX.md' | wc -l",
    ),
  };
}

function loadGates(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw new Error(`gates 檔案不存在: ${absolute}`);
  const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  return {
    gates: normalizeGates(parsed),
    meta: {
      commit: parsed.commit,
      branch: parsed.branch,
      dirtyFiles: parsed.dirtyFiles,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  let gates;
  let gateMeta = null;
  if (args.gates) {
    const loaded = loadGates(args.gates);
    gates = loaded.gates;
    gateMeta = loaded.meta;
  } else if (args.noRun) {
    gates = normalizeGates([]);
  } else {
    gates = collectGates({
      repoRoot,
      log: (id) => console.error(`[gate] ${id} ...`),
    });
  }

  const currentHead = gitText(['rev-parse', '--short', 'HEAD']) || 'unknown';
  if (gateMeta?.commit && gateMeta.commit !== currentHead) {
    console.error(
      `⚠️ gates 報告的 commit (${gateMeta.commit}) 與目前 HEAD (${currentHead}) 不同；報告可能已過期。`,
    );
  }
  const headBranch = gateMeta?.branch || gitText(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
  const dirtyFiles = Number.isFinite(gateMeta?.dirtyFiles)
    ? gateMeta.dirtyFiles
    : countDirtyFiles();
  if (dirtyFiles > 0) {
    console.error(
      `⚠️ 工作樹有 ${dirtyFiles} 個未提交變更（不含 STATUS.md）；STATUS.md 是工作樹快照，不代表任何 commit。`,
    );
  }
  const integrationRef = pickIntegrationRef();
  const integrationCommit = gitText(['rev-parse', '--short', integrationRef]) || 'unknown';

  const tasks = readTasks();
  const docsIndex = readText('docs/INDEX.md');
  const summary = summarizeTasks(tasks, {
    legacyBefore: DEFAULT_LEGACY_BEFORE,
    integrationRef,
    isAncestor,
    pathExists: (relativePath) => fs.existsSync(path.join(repoRoot, relativePath)),
    docsIndex,
  });

  const readiness = computeReadiness(gates, { blockingTasks: summary.blocking });
  const metrics = readMetrics();
  const content = renderStatus({
    branch: headBranch,
    integration: { ref: integrationRef, commit: integrationCommit },
    gates,
    readiness,
    tasks: summary,
    metrics,
    handoffs: readRecentHandoffs(),
    legacyBefore: DEFAULT_LEGACY_BEFORE,
  });

  const outputPath = args.output ? path.resolve(args.output) : statusPath;

  if (args.check) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== content) {
      console.error(
        `STATUS.md 與生成結果不一致（${outputPath}）。請執行 node scripts/generate-status.mjs 後提交。`,
      );
      process.exit(1);
    }
    console.log(`STATUS.md 與生成結果一致（${outputPath}）。`);
    return;
  }

  if (args.checkGates) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    const result = checkStatusSemantics(current, {
      gates,
      readiness,
      tasks: summary,
      metrics,
    });
    if (!result.ok) {
      console.error(`STATUS.md 的 Gate/任務摘要與目前證據不一致（${outputPath}）：`);
      for (const error of result.errors) console.error(`  - ${error}`);
      process.exit(1);
    }
    console.log(`STATUS.md 的 Gate/任務摘要與目前證據一致（${outputPath}）。`);
    return;
  }

  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`✅ 已寫入 ${outputPath}`);
  console.log(`   發布就緒: ${readiness.status}`);
  console.log(
    `   Gates: ${readiness.passed} pass / ${readiness.failed} fail / ${readiness.notRun} not-run`,
  );
  console.log(
    `   任務: ${summary.counts.total} 筆；verified ${summary.counts.verified} / legacy ${summary.counts.legacy} / active ${summary.counts.active} / issues ${summary.issues.length}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
