import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsQueueService } from './jobs-queue.service.js';

const queueMock = {
  add: vi.fn(),
  getJobCounts: vi.fn(),
  getFailed: vi.fn(),
  getJob: vi.fn(),
  close: vi.fn(),
};

vi.mock('bullmq', () => ({
  Queue: class {
    constructor() {
      return queueMock as never;
    }
  },
}));

function service(env: Record<string, string>) {
  return new JobsQueueService(new ConfigService(env));
}

describe('JobsQueueService（T278）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('QUEUE_ENABLED=false 时不建队列、不执行任何 Redis 命令', async () => {
    const jobs = service({});
    expect(jobs.enabled).toBe(false);
    expect(await jobs.enqueue('daily-jobs', '2026-10-25')).toBeNull();
    expect(await jobs.stats()).toBeNull();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('入队使用 jobId 幂等键，并带重试/退避/保留策略', async () => {
    queueMock.add.mockResolvedValue({ id: 'daily-jobs-2026-10-25' });
    const jobs = service({ QUEUE_ENABLED: 'true', QUEUE_ATTEMPTS: '4', QUEUE_BACKOFF_MS: '1000' });

    const id = await jobs.enqueue('daily-jobs', '2026-10-25');

    expect(id).toBe('daily-jobs-2026-10-25');
    expect(queueMock.add).toHaveBeenCalledWith(
      'scheduler',
      { name: 'daily-jobs' },
      expect.objectContaining({
        jobId: 'daily-jobs-2026-10-25',
        attempts: 4,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnFail: false,
      }),
    );
  });

  it('统计/失败列表/重试/清理走队列', async () => {
    queueMock.getJobCounts.mockResolvedValue({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 });
    queueMock.getFailed.mockResolvedValue([
      { id: 'j1', name: 'scheduler', data: { name: 'daily-jobs' }, failedReason: 'boom', attemptsMade: 3, timestamp: 1 },
    ]);
    const retry = vi.fn();
    const remove = vi.fn();
    queueMock.getJob.mockResolvedValue({ retry, remove });
    const jobs = service({ QUEUE_ENABLED: 'true' });

    expect(await jobs.stats()).toEqual({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 });
    expect(await jobs.failed(10)).toEqual([
      expect.objectContaining({ id: 'j1', failedReason: 'boom', attemptsMade: 3 }),
    ]);
    expect(await jobs.retry('j1')).toBe(true);
    expect(retry).toHaveBeenCalled();
    expect(await jobs.removeFailed('j1')).toBe(true);
    expect(remove).toHaveBeenCalled();
  });

  it('重试/删除不存在的 job 返回 false', async () => {
    queueMock.getJob.mockResolvedValue(null);
    const jobs = service({ QUEUE_ENABLED: 'true' });
    expect(await jobs.retry('missing')).toBe(false);
    expect(await jobs.removeFailed('missing')).toBe(false);
  });
});
