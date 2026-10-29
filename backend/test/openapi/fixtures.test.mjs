import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module, Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { findControllers, shellController, assertSame } from '../../dist/backend/src/openapi/offline-controllers.js';

function fixture(imports, entry, modules = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-fixture-'));
  writeFileSync(join(dir, 'app.module.ts'), `import { Module, forwardRef } from '@nestjs/common';\n${imports}\n@Module({ imports: [${entry}] }) class AppModule {}`);
  for (const [name, content] of Object.entries(modules)) writeFileSync(join(dir, name), content);
  return join(dir, 'app.module.ts');
}
const child = `import { Module } from '@nestjs/common'; import { DemoController } from './demo.controller.js'; @Module({controllers:[DemoController]}) export class ChildModule {}`;

test('local aliases and forwardRef resolve mounted controllers', () => {
  const file = fixture("import { ChildModule as Alias } from './child.module.js';", 'forwardRef(() => Alias)', {'child.module.ts': child});
  assert.equal(findControllers(file)[0].name, 'DemoController');
});
test('unknown or ambiguous module expressions and empty sets fail closed', () => {
  const imports = "import { ChildModule } from './child.module.js';";
  for (const expression of ['condition ? ChildModule : ChildModule', '...modules', 'ChildModule.register()', 'forwardRef(() => condition ? ChildModule : ChildModule)']) {
    assert.throws(() => findControllers(fixture(imports, expression, {'child.module.ts': child})), /Unsupported/);
  }
  assert.throws(() => findControllers(fixture("import { ChildModule } from './index.js';", 'ChildModule')), /Unsupported local/);
  assert.throws(() => findControllers(fixture("import { UnknownModule } from 'unknown';", 'UnknownModule')), /Unsupported external/);
  assert.throws(() => findControllers(fixture('', '')), /No mounted controllers/);
});
test('shell builds real swagger routes without constructing business objects', async () => {
  let traps = 0;
  class Demo { constructor() { traps++; throw new Error('constructor ran'); } handle() { return ''; } }
  Controller('fixture')(Demo);
  Get()(Demo.prototype, 'handle', Object.getOwnPropertyDescriptor(Demo.prototype, 'handle'));
  class Service { constructor() { traps++; throw new Error('provider ran'); } }
  class RuntimeModule {}
  Module({ controllers: [Demo], providers: [Service, { provide: 'FACTORY', useFactory: () => { traps++; throw new Error('factory ran'); } }] })(RuntimeModule);
  class DocumentationModule {}
  Module({ controllers: [shellController(Demo)] })(DocumentationModule);
  const app = await NestFactory.create(DocumentationModule, { logger: false });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('fixture').build());
  await app.close();
  assert.ok(doc.paths['/fixture']?.get);
  assert.equal(traps, 0);
});

test('check rejects changed route contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offline-check-'));
  const file = join(dir, 'openapi.json');
  writeFileSync(file, JSON.stringify({ paths: { '/original': { get: {} } } }));
  assert.throws(() => assertSame(file, JSON.stringify({ paths: { '/changed': { get: {} } } }), 'openapi.json'), /不一致/);
});
