#!/usr/bin/env node
/**
 * 备份文件名/保留策略纯函数（OPS-07 / T280）。
 * 供 backup-db.sh 与单元测试共用，不依赖数据库。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BACKUP_PREFIX = 'tenant';

/** 仅保留安全字符，避免数据库名进入路径时带 `../`。 */
export function safeDbName(name) {
  return String(name || 'tenant').replace(/[^A-Za-z0-9_.-]/g, '_');
}

export function backupFileName(date = new Date(), dbName = 'tenant') {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${BACKUP_PREFIX}-${safeDbName(dbName)}-${stamp}.dump`;
}

/** 从备份文件名解析 UTC 时间；不符合命名返回 null。 */
export function parseBackupDate(fileName) {
  const match = /-(\d{8})-(\d{6})\.dump$/.exec(fileName);
  if (!match) return null;
  const [, day, time] = match;
  const date = new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(4, 6)) - 1,
      Number(day.slice(6, 8)),
      Number(time.slice(0, 2)),
      Number(time.slice(2, 4)),
      Number(time.slice(4, 6)),
    ),
  );
  if (Number.isNaN(date.getTime())) return null;
  const valid =
    date.getUTCFullYear() === Number(day.slice(0, 4)) &&
    date.getUTCMonth() === Number(day.slice(4, 6)) - 1 &&
    date.getUTCDate() === Number(day.slice(6, 8)) &&
    date.getUTCHours() === Number(time.slice(0, 2)) &&
    date.getUTCMinutes() === Number(time.slice(2, 4)) &&
    date.getUTCSeconds() === Number(time.slice(4, 6));
  return valid ? date : null;
}

/** 返回应删除的文件名；无法解析的文件一律保留，避免误删。 */
export function expiredBackups(fileNames, { now = new Date(), retentionDays = 14 } = {}) {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) return [];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return fileNames.filter((name) => {
    const date = parseBackupDate(path.basename(name));
    return date !== null && date.getTime() < cutoff;
  });
}

/**
 * 数据库身份：忽略密码和 query（sslmode 等）。
 * 解析失败时退回去空白后的原串，避免把坏 URL 当成「不同库」而放行。
 */
export function databaseIdentity(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    const scheme = url.protocol.replace(':', '');
    if (scheme !== 'postgres' && scheme !== 'postgresql') return text;
    const port = url.port || '5432';
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const user = decodeURIComponent(url.username || '');
    return `${user}@${url.hostname.toLowerCase()}:${port}/${database}`;
  } catch {
    return text;
  }
}

export function sameDatabaseTarget(left, right) {
  const a = databaseIdentity(left);
  const b = databaseIdentity(right);
  return a !== '' && a === b;
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'expired') {
    const retentionDays = Number(args[0]);
    const names = args.slice(1);
    for (const name of expiredBackups(names, { retentionDays })) {
      process.stdout.write(`${name}\n`);
    }
  } else if (command === 'same-database') {
    process.exit(sameDatabaseTarget(args[0], args[1]) ? 0 : 1);
  } else {
    process.stderr.write('用法：backup-core.mjs expired <days> <file...>\n');
    process.stderr.write('      backup-core.mjs same-database <url-a> <url-b>\n');
    process.exit(2);
  }
}
