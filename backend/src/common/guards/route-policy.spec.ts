import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_GUARD } from '@nestjs/core';
import ts from 'typescript';
import { AppModule } from '../../app.module.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';

/**
 * 路由策略快照（T257 / SEC-01）。
 *
 * 静态解析 `src/**\/*.controller.ts`，导出每条 HTTP 路由的：
 * - path（含全局前缀 /api）
 * - public（类或方法是否标注 @Public()）
 * - roles（方法优先、类兜底）
 *
 * 新增/删除/改路径/改公开性都会让快照对比失败，必须先确认是预期变更，
 * 再运行 `UPDATE_ROUTE_SNAPSHOT=1 npx vitest run src/common/guards/route-policy.spec.ts`
 * 更新 `backend/test/route-policy.snapshot.json` 并随代码提交。
 */

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SNAPSHOT_PATH = fileURLToPath(new URL('../../../test/route-policy.snapshot.json', import.meta.url));
const GLOBAL_PREFIX = 'api';

const HTTP_METHODS: Record<string, string> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Options: 'OPTIONS',
  Head: 'HEAD',
  All: 'ALL',
};

export interface RoutePolicy {
  method: string;
  path: string;
  public: boolean;
  roles: string[];
}

/** 唯一的公开路由白名单：新增公开接口必须同时改这里与快照，强制人工确认。 */
const PUBLIC_ROUTE_ALLOWLIST = new Set([
  'GET /api',
  'GET /api/health',
  'GET /api/health/live',
  'GET /api/health/ready',
  'GET /api/public/buildings',
  'GET /api/public/buildings/:id/space',
  'GET /api/public/rooms',
  'GET /api/public/rooms/:id',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/refresh',
  'POST /api/auth/logout',
  'POST /api/auth/google',
  'POST /api/auth/send-email-code',
  'POST /api/auth/login-email-code',
  'GET /api/auth/google/client-id',
]);

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    return expression.expression.text;
  }
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  return undefined;
}

function decoratorStringArgs(decorator: ts.Decorator): string[] {
  const expression = decorator.expression;
  if (!ts.isCallExpression(expression)) return [];
  return expression.arguments.map((arg) =>
    ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? arg.text : '',
  );
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function hasDecorator(node: ts.Node, name: string): boolean {
  return getDecorators(node).some((decorator) => decoratorName(decorator) === name);
}

function findDecorator(node: ts.Node, name: string): ts.Decorator | undefined {
  return getDecorators(node).find((decorator) => decoratorName(decorator) === name);
}

function normalizeRoutePath(controllerPath: string, methodPath: string): string {
  const segments = [controllerPath, methodPath]
    .flatMap((part) => part.split('/'))
    .map((part) => part.trim())
    .filter(Boolean);
  return `/${GLOBAL_PREFIX}${segments.length > 0 ? `/${segments.join('/')}` : ''}`;
}

function roleList(decorator: ts.Decorator | undefined): string[] {
  return decorator ? decoratorStringArgs(decorator).filter(Boolean) : [];
}

function collectControllerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    // 目录名为 node_modules / dist 时跳过；测试文件不是路由来源
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectControllerFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.controller.ts')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function parseRoutes(filePath: string): RoutePolicy[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );

  const routes: RoutePolicy[] = [];

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;

    const controllerDecorator = findDecorator(statement, 'Controller');
    if (!controllerDecorator) continue;

    const controllerPath = decoratorStringArgs(controllerDecorator)[0] ?? '';
    const classPublic = hasDecorator(statement, 'Public');
    const classRoles = roleList(findDecorator(statement, 'Roles'));

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      for (const decorator of getDecorators(member)) {
        const httpMethod = HTTP_METHODS[decoratorName(decorator) ?? ''];
        if (!httpMethod) continue;

        const methodPath = decoratorStringArgs(decorator)[0] ?? '';
        const methodRoles = roleList(findDecorator(member, 'Roles'));

        routes.push({
          method: httpMethod,
          path: normalizeRoutePath(controllerPath, methodPath),
          public: classPublic || hasDecorator(member, 'Public'),
          roles: methodRoles.length > 0 ? methodRoles : classRoles,
        });
      }
    }
  }

  return routes;
}

function collectRoutes(): RoutePolicy[] {
  const routes = collectControllerFiles(SRC_ROOT).flatMap(parseRoutes);
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function serialize(routes: RoutePolicy[]): string {
  return `${JSON.stringify(routes, null, 2)}\n`;
}

describe('路由策略快照（T257 / SEC-01）', () => {
  const routes = collectRoutes();

  it('解析到的路由数量合理（防止解析器静默失效）', () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it('没有重复的 METHOD + PATH', () => {
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('公开路由与白名单完全一致', () => {
    const publicRoutes = routes
      .filter((route) => route.public)
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(publicRoutes).toEqual([...PUBLIC_ROUTE_ALLOWLIST].sort());
  });

  it('公开路由不得再声明角色要求', () => {
    for (const route of routes) {
      if (route.public) {
        expect(
          { route: `${route.method} ${route.path}`, roles: route.roles },
          '公开路由不应同时标注 @Roles()',
        ).toEqual({ route: `${route.method} ${route.path}`, roles: [] });
      }
    }
  });

  it('全局守卫已注册且顺序为 限流 → JWT → 角色', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;
    const globalGuards = providers
      .filter((provider) => provider?.provide === APP_GUARD)
      .map((provider) => provider.useClass);

    expect(globalGuards).toEqual([expect.any(Function), JwtAuthGuard, RolesGuard]);
  });

  it('路由策略与快照一致', () => {
    const actual = serialize(routes);

    if (process.env.UPDATE_ROUTE_SNAPSHOT === '1') {
      writeFileSync(SNAPSHOT_PATH, actual);
      return;
    }

    const expected = readFileSync(SNAPSHOT_PATH, 'utf8');
    if (actual !== expected) {
      const actualRoutes = routes.map((route) => `${route.method} ${route.path}`);
      const expectedRoutes = (JSON.parse(expected) as RoutePolicy[]).map(
        (route) => `${route.method} ${route.path}`,
      );
      const added = actualRoutes.filter((route) => !expectedRoutes.includes(route));
      const removed = expectedRoutes.filter((route) => !actualRoutes.includes(route));

      throw new Error(
        [
          '路由策略发生变化，快照未更新。',
          added.length > 0 ? `新增：${added.join(', ')}` : '',
          removed.length > 0 ? `移除：${removed.join(', ')}` : '',
          '确认是预期变更后，运行：',
          '  UPDATE_ROUTE_SNAPSHOT=1 npx vitest run src/common/guards/route-policy.spec.ts',
          '并提交 backend/test/route-policy.snapshot.json。',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  });
});
