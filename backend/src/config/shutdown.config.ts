import type { LoggerService } from '@nestjs/common';

/**
 * 优雅关闭宽限期。容器 `stop_grace_period` 为 30s，这里留 5s 余量给 Docker
 * 在 SIGKILL 之前收尾（默认 `docker stop` 只给 10s，编排里已显式放宽）。
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

export interface ShutdownSignalSource {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

export interface ShutdownWatchdogOptions {
  timeoutMs: number;
  logger: Pick<LoggerService, 'log' | 'error'>;
  exit: (code: number) => void;
  /** 测试注入；生产使用全局 setTimeout / clearTimeout。 */
  timers?: {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
}

/**
 * 收到 SIGTERM/SIGINT 后启动强制退出计时器。
 *
 * Nest 的 `enableShutdownHooks()` 会先注册同信号处理器并调用 `app.close()`；
 * 这里只兜底「关闭卡住」的情况：计时器 `unref()`，正常退出时不会拖住进程。
 * 返回取消函数，供测试或后续手动关闭使用。
 */
export function registerShutdownWatchdog(
  target: ShutdownSignalSource,
  options: ShutdownWatchdogOptions,
): () => void {
  const timers = options.timers ?? { setTimeout, clearTimeout };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = (signal: 'SIGTERM' | 'SIGINT') => {
    if (timer) return;
    options.logger.log(`收到 ${signal}，开始优雅关闭（最多 ${options.timeoutMs}ms）`);
    timer = timers.setTimeout(() => {
      timer = null;
      options.logger.error(`优雅关闭超过 ${options.timeoutMs}ms，强制退出`);
      options.exit(1);
    }, options.timeoutMs);
    timer.unref?.();
  };

  target.once('SIGTERM', () => arm('SIGTERM'));
  target.once('SIGINT', () => arm('SIGINT'));

  return () => {
    if (!timer) return;
    timers.clearTimeout(timer);
    timer = null;
  };
}
