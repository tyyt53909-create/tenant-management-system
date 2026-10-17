import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(backendRoot, 'dist');

function walk(directory) {
  const files = [];
  try {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) files.push(...walk(path));
      else if (path.endsWith('.js')) files.push(path);
    }
  } catch {
    return files;
  }
  return files;
}

for (const file of walk(dist)) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('/backend/src/')) continue;
  const next = source.replace(
    /from (['"])(?:\.\.\/)+.*?\/backend\/src\/(.+?)\1/g,
    (_full, quote, spec) => {
      let target = relative(dirname(file), resolve(dist, spec));
      if (!target.startsWith('.')) target = `./${target}`;
      return `from ${quote}${target}${quote}`;
    },
  );
  if (next !== source) {
    writeFileSync(file, next);
  }
}
