#!/usr/bin/env node
/** 读取 k6 --summary-export JSON 并按 SLO 判定（OPS-09 / T281）。 */
import { readFileSync } from 'node:fs';
import { formatSloReport } from './slo.mjs';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/slo-check.mjs /tmp/k6-summary.json');
  process.exit(2);
}

let summary;
try {
  summary = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`无法读取/解析 ${file}：${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const report = formatSloReport(summary);
console.log(report);
process.exit(report.startsWith('✅') ? 0 : 1);
