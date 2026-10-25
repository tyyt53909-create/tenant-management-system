/**
 * T289 / QLT-04：shared/ 源码直引后，tsconfig.build.json 的 rootDir 变为仓库根，
 * nest build 输出嵌套为 dist/backend/... 与 dist/shared/...（编译后的
 * `../../../../shared/` 相对导入在嵌套结构下解析到 dist/shared/，不能上移）。
 * 本脚本只清理 dist 里的测试产物；启动入口为 dist/backend/src/main.js
 * （package.json start:prod 与 backend/Dockerfile CMD 已同步）。
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(backendRoot, 'dist');

function removeSpecs(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) removeSpecs(path);
    else if (entry.endsWith('.spec.js') || entry.endsWith('.spec.d.ts') || entry.endsWith('.spec.js.map')) {
      rmSync(path);
    }
  }
}
removeSpecs(dist);
