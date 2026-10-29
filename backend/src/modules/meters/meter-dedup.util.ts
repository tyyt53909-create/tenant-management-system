import { createHash } from 'node:crypto';

export interface ReadingIdentity {
  messageId?: string;
  readingTime: Date;
  currentReading: number;
  source: string;
}

/**
 * 读数业务去重键（FIN-08 / T274）。
 *
 * - 设备上报优先用 messageId（同一消息重投必然同键）；
 * - 无 messageId 时用「时间 + 读数 + 来源」摘要：手工抄表重复提交、批量底表重复导入都会被拦下；
 * - 同一时间不同读数属于合法修正/乱序补录，摘要不同，不会被误判为重复。
 *
 * 结果写入 `MeterReading.dedupKey`，由数据库 `@@unique([meterId, dedupKey])` 兜底并发。
 */
export function buildReadingDedupKey(identity: ReadingIdentity): string {
  if (identity.messageId) return `${identity.source === 'SIMULATED' ? 'sim-msg:' : 'msg:'}${identity.messageId}`;
  const normalizedReading = Number(identity.currentReading).toFixed(2);
  const payload = `${identity.readingTime.toISOString()}|${normalizedReading}|${identity.source}`;
  return `auto:${createHash('sha256').update(payload).digest('hex').slice(0, 40)}`;
}

/**
 * 是否已结算。
 *
 * 结构化 `settledAt` 是新口径；历史数据只有 `[SETTLED]` / `[INITIAL]` 备注，
 * 两者必须同时识别，否则升级后会把历史读数再扣一次费。
 */
export function isSettledReading(reading: {
  settledAt?: Date | null;
  notes?: string | null;
}): boolean {
  if (reading.settledAt) return true;
  const notes = reading.notes ?? '';
  return notes.includes('[SETTLED]') || notes.includes('[INITIAL]');
}

export function isUniqueViolation(error: unknown, field?: string): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code !== 'P2002') return false;
  if (!field) return true;
  const meta = (error as { meta?: { target?: unknown } } | null)?.meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === 'string') return target.includes(field);
  return false;
}

/** 保留历史结算标记供读取旧记录，禁止外部输入伪造。 */
export function hasReservedReadingMarker(value?: string | null): boolean {
  return value?.includes('[SETTLED]') === true || value?.includes('[INITIAL]') === true;
}
