import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { relative } from 'node:path';
import { findControllers, shellController, assertSame } from './offline-controllers.js';
import { pathToFileURL } from 'node:url';
import { countOperations, createOpenApiDocument } from './openapi.document.js';

const openApiPath = resolve(process.cwd(), 'openapi.json');
const frontendTypesPath = resolve(process.cwd(), '../frontend-admin/src/types/api.generated.ts');

async function main() {
  const check = process.argv.includes('--check');
  // Walk only modules actually named in @Module imports; never import AppModule.
  const sourceRoot = resolve(process.cwd(), 'src');
  const compiledRoot = resolve(process.cwd(), 'dist/backend/src');
  const controllerRefs = findControllers(resolve(sourceRoot, 'app.module.ts'));
  const offlineControllers = await Promise.all(controllerRefs.map(async ref => {
    const compiled = resolve(compiledRoot, relative(sourceRoot, ref.path).replace(/\.ts$/, '.js'));
    const Controller = (await import(pathToFileURL(compiled).href))[ref.name];
    if (typeof Controller !== 'function') throw new Error(`Controller export missing: ${ref.name}`);
    return shellController(Controller);
  }));
  @Module({ controllers: offlineControllers })
  class DocumentationModule {}
  const app = await NestFactory.create(DocumentationModule, { logger: ['error'] });
  app.setGlobalPrefix('api');
  const document = createOpenApiDocument(app);
  await app.close();

  const operations = countOperations(document);
  if (operations < 85) {
    throw new Error(`OpenAPI 只有 ${operations} 条路由，验收要求至少 85 条`);
  }

  // Preserve existing key order only; values and membership always come from the newly scanned document.
  const orderLike = (value: any, previous: any): any => {
    if (Array.isArray(value)) return value.map((item, index) => orderLike(item, Array.isArray(previous) ? previous[index] : undefined));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    const oldKeys = previous && typeof previous === 'object' && !Array.isArray(previous) ? Object.keys(previous) : [];
    for (const key of [...oldKeys.filter(key => Object.hasOwn(value, key)), ...Object.keys(value).filter(key => !oldKeys.includes(key))]) result[key] = orderLike(value[key], previous?.[key]);
    return result;
  };
  const previous = existsSync(openApiPath) ? JSON.parse(readFileSync(openApiPath, 'utf8')) : undefined;
  const json = `${JSON.stringify(orderLike(document, previous), null, 2)}\n`;
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


void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
