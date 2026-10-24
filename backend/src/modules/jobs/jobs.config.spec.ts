import { describe, expect, it } from 'vitest';
import { loadJobsConfig } from './jobs.config.js';

describe('jobs config（T278）', () => {
  it('默认关闭队列，给出重试/并发默认值', () => {
    const config = loadJobsConfig(() => undefined);
    expect(config).toEqual({
      enabled: false,
      concurrency: 2,
      attempts: 3,
      backoffMs: 5000,
      prefix: 'tenant-jobs',
    });
  });

  it('读取 env 并拒绝非法数字回退默认值', () => {
    const config = loadJobsConfig((key) =>
      ({
        QUEUE_ENABLED: 'TRUE',
        QUEUE_CONCURRENCY: '4',
        QUEUE_ATTEMPTS: '0',
        QUEUE_BACKOFF_MS: 'abc',
        QUEUE_PREFIX: '',
      })[key],
    );
    expect(config).toMatchObject({
      enabled: true,
      concurrency: 4,
      attempts: 3,
      backoffMs: 5000,
      prefix: 'tenant-jobs',
    });
  });
});
