import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryOtpStore, type OtpRecord } from './otp-store.js';

function record(over: Partial<OtpRecord> = {}): OtpRecord {
  return {
    codeHash: 'a'.repeat(64),
    salt: 'b'.repeat(32),
    expiresAt: Date.now() + 5 * 60 * 1000,
    lastSentAt: Date.now(),
    ...over,
  };
}

describe('MemoryOtpStore', () => {
  let store: MemoryOtpStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryOtpStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('读写与删除记录', async () => {
    await store.set('tenant@example.com', record());
    expect(await store.get('tenant@example.com')).toBeDefined();
    await store.delete('tenant@example.com');
    expect(await store.get('tenant@example.com')).toBeUndefined();
  });

  it('失败计数原子累加', async () => {
    expect(await store.incrementFailedAttempts('tenant@example.com', 60_000)).toBe(1);
    expect(await store.incrementFailedAttempts('tenant@example.com', 60_000)).toBe(2);
    expect(await store.getFailedAttempts('tenant@example.com')).toBe(2);
  });

  it('并发失败不丢计数', async () => {
    const counts = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.incrementFailedAttempts('tenant@example.com', 60_000),
      ),
    );
    expect(Math.max(...counts)).toBe(20);
    expect(await store.getFailedAttempts('tenant@example.com')).toBe(20);
  });

  it('重置失败计数', async () => {
    await store.incrementFailedAttempts('tenant@example.com', 60_000);
    await store.resetFailedAttempts('tenant@example.com');
    expect(await store.getFailedAttempts('tenant@example.com')).toBe(0);
  });

  it('计数窗口过期后归零', async () => {
    await store.incrementFailedAttempts('tenant@example.com', 1_000);
    vi.advanceTimersByTime(1_001);
    expect(await store.getFailedAttempts('tenant@example.com')).toBe(0);
  });
});
