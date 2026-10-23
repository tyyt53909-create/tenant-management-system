import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHUTDOWN_TIMEOUT_MS, registerShutdownWatchdog } from './shutdown.config.js';

class FakeSignals {
  readonly listeners = new Map<string, () => void>();

  once(event: 'SIGTERM' | 'SIGINT', listener: () => void) {
    this.listeners.set(event, listener);
    return this;
  }

  emit(event: 'SIGTERM' | 'SIGINT') {
    this.listeners.get(event)?.();
  }
}

function createHarness() {
  const target = new FakeSignals();
  const logger = { log: vi.fn(), error: vi.fn() };
  const exit = vi.fn();
  const cancel = registerShutdownWatchdog(target, {
    timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
    logger,
    exit,
  });
  return { target, logger, exit, cancel };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('registerShutdownWatchdog', () => {
  it('同时监听 SIGTERM 与 SIGINT', () => {
    vi.useFakeTimers();
    const { target, exit } = createHarness();

    expect(target.listeners.has('SIGTERM')).toBe(true);
    expect(target.listeners.has('SIGINT')).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  });

  it('收到 SIGTERM 后记录日志，超时才强制退出', () => {
    vi.useFakeTimers();
    const { target, logger, exit } = createHarness();

    target.emit('SIGTERM');
    expect(logger.log).toHaveBeenCalledWith(
      `收到 SIGTERM，开始优雅关闭（最多 ${DEFAULT_SHUTDOWN_TIMEOUT_MS}ms）`,
    );
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEFAULT_SHUTDOWN_TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('正常关闭时取消计时器，不会强制退出', () => {
    vi.useFakeTimers();
    const { target, exit, cancel } = createHarness();

    target.emit('SIGINT');
    cancel();
    vi.advanceTimersByTime(DEFAULT_SHUTDOWN_TIMEOUT_MS);

    expect(exit).not.toHaveBeenCalled();
  });

  it('重复信号不会启动多个计时器', () => {
    vi.useFakeTimers();
    const { target, logger, exit } = createHarness();

    target.emit('SIGTERM');
    target.emit('SIGTERM');
    target.emit('SIGINT');

    expect(logger.log).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(DEFAULT_SHUTDOWN_TIMEOUT_MS);
    expect(exit).toHaveBeenCalledOnce();
  });
});
