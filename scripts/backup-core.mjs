#!/usr/bin/env node
/**
 * 备份文件名/保留策略纯函数（OPS-07 / T280）。
 * 供 backup-db.sh 与单元测试共用，不依赖数据库。
 */
import path from 'node:path';

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
