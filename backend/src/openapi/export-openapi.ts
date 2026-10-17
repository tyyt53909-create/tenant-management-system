import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { countOperations, createOpenApiDocument } from './openapi.document.js';

const openApiPath = resolve(process.cwd(), 'openapi.json');
const frontendTypesPath = resolve(process.cwd(), '../frontend-admin/src/types/api.generated.ts');

async function main() {
  const check = process.argv.includes('--check');
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  const document = createOpenApiDocument(app);
  await app.close();

  const operations = countOperations(document);
  if (operations < 85) {
    throw new Error(`OpenAPI 只有 ${operations} 条路由，验收要求至少 85 条`);
  }

  const json = `${JSON.stringify(document, null, 2)}\n`;
  const types = renderFrontendTypes(json);
  if (check) {
    assertSame(openApiPath, json, 'openapi.json');
    assertSame(frontendTypesPath, types, 'frontend-admin/src/types/api.generated.ts');
    console.log(`OpenAPI ${operations} 条路由，与已提交文件一致`);
    process.exit(0);
  }

  writeFileSync(openApiPath, json);
  writeFileSync(frontendTypesPath, types);
  console.log(`已写入 openapi.json 与前端类型，共 ${operations} 条路由`);
  process.exit(0);
}

function renderFrontendTypes(json: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'openapi-'));
  const source = join(directory, 'openapi.json');
  const target = join(directory, 'api.generated.ts');
  writeFileSync(source, json);
  execFileSync('npx', ['openapi-typescript', source, '--output', target], { stdio: 'inherit' });
  return readFileSync(target, 'utf8');
}

function assertSame(path: string, next: string, label: string) {
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`缺少 ${label}。请运行 npm run openapi:generate 后提交。`);
  }
  if (current !== next) {
    throw new Error(`${label} 与代码不一致。请重新运行 npm run openapi:generate 后提交。`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
