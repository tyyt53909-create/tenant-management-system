#!/usr/bin/env node
/**
 * staging / 发布后冒烟（OPS-08 / T251）。
 *
 * 只依赖 Node 内置 fetch，无第三方包；可在 runner、跳板机或本地运行。
 *
 * 用法：
 *   BASE_URL=https://staging.example.com/api node scripts/smoke.mjs
 *   BASE_URL=http://127.0.0.1:3100/api node scripts/smoke.mjs
 *
 * 退出码：全部通过 0；任一检查失败 1。
 */

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3100/api').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 8000);

const checks = [
  { name: '健康检查 /health', path: '/health', expect: 200, json: false },
  { name: '就绪检查 /health/ready', path: '/health/ready', expect: 200, json: false },
  { name: '公开房源 /public/rooms', path: '/public/rooms', expect: 200, json: true },
  {
    name: '未知公开文件应 404（不泄露存在性）',
    path: '/public/files/__smoke_missing__',
    expect: 404,
    json: false,
  },
];

let failed = 0;

for (const check of checks) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE_URL}${check.path}`, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
    const elapsed = Date.now() - started;
    const ok = response.status === check.expect;
    if (ok && check.json) {
      const text = await response.text();
      try {
        JSON.parse(text);
      } catch {
        throw new Error('响应不是合法 JSON');
      }
    }
    console.log(`${ok ? 'PASS' : 'FAIL'} ${check.name} -> ${response.status} (${elapsed}ms)`);
    if (!ok) failed += 1;
  } catch (error) {
    const elapsed = Date.now() - started;
    console.log(`FAIL ${check.name} -> ${(error && error.message) || error} (${elapsed}ms)`);
    failed += 1;
  } finally {
    clearTimeout(timer);
  }
}

if (failed > 0) {
  console.error(`\n❌ ${failed} 项冒烟失败：${BASE_URL}`);
  process.exit(1);
}
console.log(`\n✅ 冒烟全部通过：${BASE_URL}`);
