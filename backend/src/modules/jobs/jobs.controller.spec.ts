import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsController } from './jobs.controller.js';
import { JobsQueueService } from './jobs-queue.service.js';

describe('JobsController（T278）', () => {
  let controller: JobsController;
  let jobs: {
    enabled: boolean;
    stats: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    removeFailed: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    jobs = {
      enabled: true,
      stats: vi.fn().mockResolvedValue({ waiting: 1 }),
      failed: vi.fn().mockResolvedValue([]),
      retry: vi.fn().mockResolvedValue(true),
      removeFailed: vi.fn().mockResolvedValue(true),
    };
    const module = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [{ provide: JobsQueueService, useValue: jobs }],
    }).compile();
    controller = module.get(JobsController);
  });

  it('stats 返回 enabled 与计数', async () => {
    await expect(controller.stats()).resolves.toEqual({ enabled: true, stats: { waiting: 1 } });
  });

  it('failed 解析 limit 并限制上限', async () => {
    await controller.failed('500');
    expect(jobs.failed).toHaveBeenCalledWith(500);
    await controller.failed(undefined);
    expect(jobs.failed).toHaveBeenCalledWith(20);
  });

  it('retry/remove 不存在时 404', async () => {
    jobs.retry.mockResolvedValue(false);
    jobs.removeFailed.mockResolvedValue(false);
    await expect(controller.retry('missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
