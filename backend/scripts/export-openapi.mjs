import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(backendRoot, 'dist');

const build = spawnSync('npx', ['nest', 'build'], {
  cwd: backendRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status) process.exit(build.status ?? 1);

rewriteSwaggerImports(dist);
await import(pathToFileURL(join(dist, 'openapi/export-openapi.js')).href);

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
