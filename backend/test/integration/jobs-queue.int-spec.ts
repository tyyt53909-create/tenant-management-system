import { ConfigService } from '@nestjs/config';
import { afterAll, describe, expect, it } from 'vitest';
import { JobsQueueService } from '../../src/modules/jobs/jobs-queue.service.js';

/** OPS-05 / T278：BullMQ 生产者与真实 Redis 的往返。 */
const prefix = `tenant-jobs-test-${Date.now()}`;
const service = new JobsQueueService(
  new ConfigService({
    QUEUE_ENABLED: 'true',
    QUEUE_PREFIX: prefix,
    QUEUE_ATTEMPTS: '2',
    QUEUE_BACKOFF_MS: '1000',
  }),
);

afterAll(async () => {
  await service.onModuleDestroy();
});

describe('任务队列（OPS-05）', () => {
  it('入队后可在 waiting/delayed 中看到，重复 dedupeKey 不新增 job', async () => {
    const first = await service.enqueue('daily-jobs', '2026-10-25');
    const second = await service.enqueue('daily-jobs', '2026-10-25');

    expect(first).toBeTruthy();
    expect(second).toBe(first);

    const stats = await service.stats();
    const pending = (stats?.waiting ?? 0) + (stats?.delayed ?? 0) + (stats?.active ?? 0);
    expect(pending).toBeGreaterThanOrEqual(1);
    expect(await service.failed()).toEqual([]);
  });

  it('QUEUE_ENABLED=false 时不产生 job', async () => {
    const disabled = new JobsQueueService(new ConfigService({ QUEUE_ENABLED: 'false' }));
    expect(await disabled.enqueue('daily-jobs', 'disabled')).toBeNull();
    expect(await disabled.stats()).toBeNull();
    await disabled.onModuleDestroy();
  });
});
