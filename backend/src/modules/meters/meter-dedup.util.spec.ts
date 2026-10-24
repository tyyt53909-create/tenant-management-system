import { describe, expect, it } from 'vitest';
import { buildReadingDedupKey, isSettledReading, isUniqueViolation } from './meter-dedup.util.js';

describe('读数去重键（T274）', () => {
  const readingTime = new Date('2026-10-11T10:00:00Z');

  it('messageId 优先，同一消息必定同键', () => {
    const a = buildReadingDedupKey({ messageId: 'msg-1', readingTime, currentReading: 10, source: 'DEVICE' });
    const b = buildReadingDedupKey({ messageId: 'msg-1', readingTime: new Date(), currentReading: 99, source: 'DEVICE' });
    expect(a).toBe('msg:msg-1');
    expect(a).toBe(b);
  });

  it('无 messageId 时由时间+读数+来源生成稳定摘要', () => {
    const a = buildReadingDedupKey({ readingTime, currentReading: 10, source: 'MANUAL' });
    const b = buildReadingDedupKey({ readingTime: new Date(readingTime), currentReading: 10, source: 'MANUAL' });
    expect(a).toBe(b);
    expect(a).toMatch(/^auto:[a-f0-9]{40}$/);
  });

  it('同时间不同读数/不同来源是不同键（合法修正不应被误判重复）', () => {
    const base = buildReadingDedupKey({ readingTime, currentReading: 10, source: 'MANUAL' });
    expect(buildReadingDedupKey({ readingTime, currentReading: 11, source: 'MANUAL' })).not.toBe(base);
    expect(buildReadingDedupKey({ readingTime, currentReading: 10, source: 'DEVICE' })).not.toBe(base);
  });

  it('已结算判断同时认结构化字段与历史备注', () => {
    expect(isSettledReading({ settledAt: new Date(), notes: null })).toBe(true);
    expect(isSettledReading({ settledAt: null, notes: '[SETTLED] x' })).toBe(true);
    expect(isSettledReading({ settledAt: null, notes: '[INITIAL] 底数' })).toBe(true);
    expect(isSettledReading({ settledAt: null, notes: '日常采集' })).toBe(false);
  });

  it('只把 dedupKey 的 P2002 当作重复，其余唯一冲突继续上抛', () => {
    const error = { code: 'P2002', meta: { target: ['meterId', 'dedupKey'] } };
    expect(isUniqueViolation(error, 'dedupKey')).toBe(true);
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['meterNumber'] } }, 'dedupKey')).toBe(false);
    expect(isUniqueViolation(new Error('boom'), 'dedupKey')).toBe(false);
  });
});
