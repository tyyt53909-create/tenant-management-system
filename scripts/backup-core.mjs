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

// 这些 libpq 参数可覆盖 URL 中的目标，不能参与静态同库比较。
const ROUTING_PARAMETERS = ['host', 'hostaddr', 'port', 'dbname', 'service'];

export function databaseIdentity(raw) {
  if (typeof raw !== 'string' || /[\s\\#]/.test(raw)) return null;
  const parts = /^postgres(?:ql)?:\/\/[^/?]+(\/[^?]+)(?:\?.*)?$/.exec(raw);
  if (!parts) return null;
  try {
    const url = new URL(raw);
    if (url.pathname !== parts[1]) return null;
    if (!/^(?:[a-z0-9._-]+|\[[0-9a-f:]+\])$/i.test(url.hostname)) return null;
    if (ROUTING_PARAMETERS.some((key) => url.searchParams.has(key))) return null;

    const database = decodeURIComponent(url.pathname.slice(1));
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const port = url.port ? Number(url.port) : 5432;
    if (!hostname || !database || database.includes('\0') || port === 0) return null;

    // 登录账号、密码和非路由参数不改变数据库身份。
    return JSON.stringify([hostname, port, database]);
  } catch {
    return null;
  }
}

export function sameDatabaseTarget(left, right) {
  const a = databaseIdentity(left);
  const b = databaseIdentity(right);
  return a === null || b === null ? null : a === b;
}

/** 仅移除 Prisma 的 schema，不重编码 libpq 参数、密码或库名。 */
function libpqUrl(raw) {
  const queryStart = raw.indexOf('?');
  if (queryStart === -1) return raw;
  const kept = raw.slice(queryStart + 1).split('&').filter((parameter) => {
    const equals = parameter.indexOf('=');
    return equals === -1 || decodeURIComponent(parameter.slice(0, equals)) !== 'schema';
  });
  return raw.slice(0, queryStart) + (kept.length ? `?${kept.join('&')}` : '');
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
  } else if (command === 'rehearsal-target') {
    const { DATABASE_URL, REHEARSAL_DATABASE_URL } = process.env;
    // 在原始连接串上检查路由覆盖，不能用清理步骤掩盖它们。
    const same = sameDatabaseTarget(REHEARSAL_DATABASE_URL, DATABASE_URL);
    if (same === true) {
      process.exitCode = 3;
    } else if (same === null) {
      process.exitCode = 2;
    } else {
      try {
        process.stdout.write(libpqUrl(REHEARSAL_DATABASE_URL));
      } catch {
        process.exitCode = 2;
      }
    }
  } else {
    process.stderr.write('用法：backup-core.mjs expired <days> <file...>\n');
    process.stderr.write('      backup-core.mjs rehearsal-target (读取 DATABASE_URL 和 REHEARSAL_DATABASE_URL)\n');
    process.exit(2);
  }
}
