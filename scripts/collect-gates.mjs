#!/usr/bin/env node

/**
 * 執行所有 gate，輸出 artifacts/gates.json 給 generate-status.mjs 使用。
 *
 * 這個命令即使有 gate 失敗也會寫出報告（讓看板能顯示紅燈）；
 * 若 CI 要直接以 gate 成敗阻擋，加上 --fail-on-gate。
 *
 * 用法:
 *   node scripts/collect-gates.mjs
 *   node scripts/collect-gates.mjs --output artifacts/gates.json
 *   node scripts/collect-gates.mjs --fail-on-gate
 *   node scripts/collect-gates.mjs --quiet
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectGates } from './gates.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { output: 'artifacts/gates.json', failOnGate: false, quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--output 需要一個值');
      args.output = value;
      index += 1;
    } else if (arg === '--fail-on-gate') {
      args.failOnGate = true;
    } else if (arg === '--quiet') {
      args.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`未知參數: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`用法: node scripts/collect-gates.mjs [選項]

選項:
  --output <path>   輸出 JSON 路徑（預設 artifacts/gates.json）
  --fail-on-gate    任何 gate fail/blocked 時 exit 1
  --quiet           不輸出每個 gate 的進度
  -h, --help        顯示說明
`);
}

function gitText(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function countDirtyFiles() {
  const output = gitText(['status', '--porcelain=v1', '--untracked-files=all']);
  // STATUS.md 是生成物；排除它，避免報告把生成檔本身算成 dirty。
  return output
    ? output.split('\n').filter((line) => line.trim() && !line.endsWith('STATUS.md')).length
    : 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor !== 20) {
    console.error(
      `⚠️ 目前 Node ${process.version}；CI 使用 Node 20.x，本地 gate 結果可能與 CI 不同（例如 locale 排序）。`,
    );
  }

  const gates = collectGates({
    repoRoot,
    log: args.quiet ? undefined : (id) => console.error(`[gate] ${id} ...`),
  });

  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    commit: gitText(['rev-parse', '--short', 'HEAD']) || 'unknown',
    commitDate: gitText(['show', '-s', '--format=%cs', 'HEAD']) || 'unknown',
    branch: process.env.GITHUB_HEAD_REF || gitText(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
    dirtyFiles: countDirtyFiles(),
    gates,
  };

  const outputPath = path.isAbsolute(args.output)
    ? args.output
    : path.join(repoRoot, args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const failed = gates.filter((gate) => gate.status === 'fail' || gate.status === 'blocked');
  const notRun = gates.filter((gate) => gate.status === 'not-run');

  console.log(`✅ 已寫入 ${outputPath}`);
  console.log(
    `   Gates: ${gates.filter((gate) => gate.status === 'pass').length} pass / ${failed.length} fail / ${notRun.length} not-run`,
  );
  if (failed.length) {
    for (const gate of failed) console.error(`   ❌ ${gate.id}: ${gate.evidence}`);
  }

  if (args.failOnGate && failed.length) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
