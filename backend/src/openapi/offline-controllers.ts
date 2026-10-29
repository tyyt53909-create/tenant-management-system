import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

export function findControllers(entry: string): Array<{ path: string; name: string }> {
  const seen = new Set<string>();
  const controllerRefs: Array<{ path: string; name: string }> = [];
  function visit(path: string, moduleName?: string): void {
    const key = `${path}#${moduleName ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports = new Map<string, { path: string; name: string; origin: string }>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const file = resolve(dirname(path), statement.moduleSpecifier.text.replace(/\.js$/, '.ts'));
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) imports.set(item.name.text, { path: file, name: item.propertyName?.text ?? item.name.text, origin: statement.moduleSpecifier.text });
    }
    let found = false;
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || (moduleName && statement.name?.text !== moduleName)) continue;
      for (const decorator of ts.getDecorators(statement) ?? []) {
        const call = decorator.expression;
        if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'Module') continue;
        found = true;
        const object = call.arguments[0];
        if (!object || !ts.isObjectLiteralExpression(object)) throw new Error(`Unsupported module metadata: ${path}`);
        for (const property of object.properties) {
          if (ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name)) || (ts.isShorthandPropertyAssignment(property) && ['imports', 'controllers'].includes(property.name.text))) throw new Error(`Unsupported module metadata property: ${path}`);
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !['imports', 'controllers'].includes(property.name.text)) continue;
          if (!ts.isArrayLiteralExpression(property.initializer)) throw new Error(`Unsupported ${property.name.text} metadata: ${path}`);
          for (const element of property.initializer.elements) {
            if (property.name.text === 'controllers') {
              if (!ts.isIdentifier(element) || !imports.get(element.text)?.origin.startsWith('.')) throw new Error(`Unsupported controller: ${path}`);
              controllerRefs.push(imports.get(element.text)!);
            } else {
              let expr: ts.Expression = element;
              if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'forwardRef') {
                const arg = expr.arguments[0];
                if (expr.arguments.length !== 1 || !ts.isArrowFunction(arg) || !ts.isIdentifier(arg.body)) throw new Error(`Unsupported forwardRef: ${path}`);
                expr = arg.body;
              }
              let method: string | undefined;
              if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.expression)) {
                method = expr.expression.name.text;
                // Dynamic infrastructure modules may themselves import feature modules.
                // Only inspect explicit literal import lists; never silently omit them.
                const inspect = (node: ts.Node): void => {
                  if (ts.isSpreadAssignment(node)) throw new Error(`Unsupported dynamic options spread: ${path}`);
                  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'imports') {
                    if (!ts.isArrayLiteralExpression(node.initializer)) throw new Error(`Unsupported dynamic imports: ${path}`);
                    for (const item of node.initializer.elements) {
                      if (!ts.isIdentifier(item)) throw new Error(`Unsupported dynamic import: ${path}`);
                      const nested = imports.get(item.text);
                      if (!nested) throw new Error(`Unknown dynamic import ${item.text}: ${path}`);
                      if (nested.origin.startsWith('.')) {
                        if (!nested.origin.endsWith('.module.js')) throw new Error(`Unsupported dynamic local module: ${path}`);
                        visit(nested.path, nested.name);
                      } else if (nested.origin !== '@nestjs/config' || nested.name !== 'ConfigModule') {
                        throw new Error(`Unsupported dynamic external module: ${path}`);
                      }
                    }
                    return;
                  }
                  ts.forEachChild(node, inspect);
                };
                for (const arg of expr.arguments) {
                  if (!ts.isObjectLiteralExpression(arg) && !(expr.expression.expression.text === 'ConfigModule' && method === 'forFeature' && ts.isIdentifier(arg))) throw new Error(`Unsupported dynamic options: ${path}`);
                  inspect(arg);
                }
                expr = expr.expression.expression;
              }
              if (!ts.isIdentifier(expr)) throw new Error(`Unsupported module import: ${path}`);
              const ref = imports.get(expr.text);
              if (!ref) throw new Error(`Unknown module import ${expr.text}: ${path}`);
              const allowed: Record<string, Record<string, string[]>> = {
                '@nestjs/config': { ConfigModule: ['forRoot', 'forFeature'] },
                '@nestjs/throttler': { ThrottlerModule: ['forRootAsync'] },
                '@nestjs/passport': { PassportModule: ['register'] },
                '@nestjs/jwt': { JwtModule: ['registerAsync'] },
                '@nestjs/schedule': { ScheduleModule: ['forRoot'] },
              };
              if (ref.origin.startsWith('.')) {
                if (method || !ref.origin.endsWith('.module.js')) throw new Error(`Unsupported local module import ${expr.text}: ${path}`);
                visit(ref.path, ref.name);
              } else if (!allowed[ref.origin]?.[ref.name] || (method && !allowed[ref.origin][ref.name].includes(method))) {
                throw new Error(`Unsupported external module import ${ref.origin}:${ref.name}: ${path}`);
              }
            }
          }
        }
      }
    }
    if (!found) throw new Error(`Module declaration not found: ${path}`);
  }
  visit(entry);
  if (!controllerRefs.length) throw new Error('No mounted controllers found');
  return controllerRefs;

}

export function shellController(Controller: any): any {
    class OfflineController {}
    Object.setPrototypeOf(OfflineController, Controller);
    Object.setPrototypeOf(OfflineController.prototype, Controller.prototype);
    Object.defineProperty(OfflineController, 'name', { value: Controller.name });
    Reflect.defineMetadata('design:paramtypes', [], OfflineController);
    Reflect.defineMetadata('self:paramtypes', [], OfflineController);
    Reflect.defineMetadata('optional:paramtypes', [], OfflineController);
    return OfflineController;
}

export function assertSame(path: string, next: string, label: string) {
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

