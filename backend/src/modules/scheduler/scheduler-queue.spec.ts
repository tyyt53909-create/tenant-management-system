import { describe, expect, it, vi } from 'vitest';
import { SchedulerService } from './scheduler.service.js';

function build(options: { role?: string; enabled?: boolean }) {
  const jobs = { enabled: options.enabled ?? false, enqueue: vi.fn().mockResolvedValue('job-1') };
  const config = {
    get: (key: string) => (key === 'PROCESS_ROLE' ? (options.role ?? 'web') : undefined),
  };
  const service = new SchedulerService(
    {} as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    config as never,
    jobs as never,
  );
  const rerun = vi.spyOn(service, 'rerun').mockResolvedValue({ status: 'SUCCESS' } as never);
  return { service, jobs, rerun };
}

describe('Scheduler 队列触发（T278）', () => {
  it('队列开启时 cron 只入队，不在 Web 进程执行', async () => {
    const { service, jobs, rerun } = build({ enabled: true });
    await service.handleDailyCron();
    expect(jobs.enqueue).toHaveBeenCalledWith('daily-jobs', expect.any(String));
    expect(rerun).not.toHaveBeenCalled();
  });

  it('Worker 角色不触发 cron', async () => {
    const { service, jobs, rerun } = build({ role: 'worker', enabled: true });
    await service.handleDailyCron();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(rerun).not.toHaveBeenCalled();
  });

  it('队列关闭时保持同步执行', async () => {
    const { service, jobs, rerun } = build({ enabled: false });
    await service.handleDailyCron();
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(rerun).toHaveBeenCalledWith('daily-jobs', 'CRON');
  });
});
