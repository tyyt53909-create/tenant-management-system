import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'openapi-export-jwt-secret-min-32-bytes!';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(backendRoot, 'dist');

const build = spawnSync('npx', ['nest', 'build'], {
  cwd: backendRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status) process.exit(build.status ?? 1);

rewriteSwaggerImports(dist);
// T289：rootDir 变为仓库根后 nest build 输出嵌套在 dist/backend/... 下
const exportEntry =
  existsSync(join(dist, 'openapi/export-openapi.js'))
    ? join(dist, 'openapi/export-openapi.js')
    : join(dist, 'backend/src/openapi/export-openapi.js');
await import(pathToFileURL(exportEntry).href);

function rewriteSwaggerImports(directory) {
  for (const file of walk(directory)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('/backend/src/')) continue;
    const next = source.replace(
      /from (['"])(?:\.\.\/)+.*?\/backend\/src\/(.+?)\1/g,
      (_full, quote, spec) => {
        let target = relative(dirname(file), resolve(directory, spec));
        if (!target.startsWith('.')) target = `./${target}`;
        return `from ${quote}${target}${quote}`;
      },
    );
    if (next !== source) writeFileSync(file, next);
  }
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith('.js')) files.push(path);
  }
  return files;
}
