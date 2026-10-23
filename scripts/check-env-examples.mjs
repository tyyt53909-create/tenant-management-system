#!/usr/bin/env node

/**
 * 校验环境变量模板是否覆盖 env.schema.ts 的全部键。
 *
 * 说明：模板仍由人工维护（带业务注释），这里做一致性门禁，避免新增变量只改代码、
 * 漏改模板导致部署时才发现缺项。CI 在 status-check / backend CI 中调用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(repoRoot, 'backend/src/config/env.schema.ts');
const templates = ['backend/.env.example', '.env.prod.example'];

const schema = fs.readFileSync(schemaPath, 'utf8');
const keys = [...schema.matchAll(/key:\s*'([A-Z0-9_]+)'/g)].map((match) => match[1]);
if (keys.length === 0) {
  console.error('未从 env.schema.ts 解析到任何环境变量键');
  process.exit(1);
}

let failed = false;
for (const template of templates) {
  const absolute = path.join(repoRoot, template);
  if (!fs.existsSync(absolute)) {
    console.error(`缺少模板：${template}`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(absolute, 'utf8');
  const missing = keys.filter((key) => !new RegExp(`^#?\\s*${key}=`, 'm').test(content));
  if (missing.length > 0) {
    console.error(`${template} 缺少 ${missing.length} 个变量：${missing.join(', ')}`);
    failed = true;
  } else {
    console.log(`${template} 覆盖 ${keys.length} 个变量`);
  }
}

if (failed) process.exit(1);
console.log('环境变量模板与 env.schema.ts 一致');
