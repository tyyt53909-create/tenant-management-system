import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type ConnectionOptions } from 'bullmq';
import { resolveRedisConnection } from '../../redis/redis.config.js';
import { loadJobsConfig, type JobsConfig } from './jobs.config.js';

export const SCHEDULER_QUEUE = 'scheduler';

/**
 * 定时任务生产者（OPS-05 / T278）。
 *
 * - `QUEUE_ENABLED=false`（默认）时不建立 Redis 连接，调用方走原来的同步执行。
 * - `jobId = scheduler:{name}:{dedupeKey}` 保证多实例 cron 同时触发时只入队一次。
 */
@Injectable()
export class JobsQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(JobsQueueService.name);
  private readonly config: JobsConfig;
  private queue: Queue | null = null;

  constructor(private readonly configService: ConfigService) {
    this.config = loadJobsConfig((key) => this.configService.get<string>(key));
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async enqueue(name: string, dedupeKey: string): Promise<string | null> {
    const queue = this.getQueue();
    if (!queue) return null;
    // BullMQ 的 custom jobId 不允许冒号，用短横线保持「任务+日期」可读
    const jobId = `${name}-${dedupeKey}`;
    const job = await queue.add(
      'scheduler',
      { name },
      {
        jobId,
        attempts: this.config.attempts,
        backoff: { type: 'exponential', delay: this.config.backoffMs },
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      },
    );
    return job.id ?? null;
  }

  async stats(): Promise<Record<string, number> | null> {
    const queue = this.getQueue();
    if (!queue) return null;
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    };
  }

  async failed(limit = 20) {
    const queue = this.getQueue();
    if (!queue) return [];
    const jobs = await queue.getFailed(0, Math.max(0, Math.min(limit, 100)) - 1);
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data as { name?: string } | undefined,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
    }));
  }

  async retry(id: string): Promise<boolean> {
    const queue = this.getQueue();
    if (!queue) return false;
    const job = await queue.getJob(id);
    if (!job) return false;
    await job.retry();
    return true;
  }

  async removeFailed(id: string): Promise<boolean> {
    const queue = this.getQueue();
    if (!queue) return false;
    const job = await queue.getJob(id);
    if (!job) return false;
    await job.remove();
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.close();
    } catch (error) {
      this.logger.warn(`关闭任务队列失败：${error instanceof Error ? error.message : String(error)}`);
    }
    this.queue = null;
  }

  /** 供 Worker 入口复用同一套连接配置。 */
  connectionOptions(): ConnectionOptions {
    return {
      ...resolveRedisConnection((key) => this.configService.get<string>(key)),
      // BullMQ 要求阻塞连接不能因单次命令失败而断开
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }

  queuePrefix(): string {
    return this.config.prefix;
  }

  workerConcurrency(): number {
    return this.config.concurrency;
  }

  private getQueue(): Queue | null {
    if (!this.config.enabled) return null;
    if (!this.queue) {
      this.queue = new Queue(SCHEDULER_QUEUE, {
        connection: this.connectionOptions(),
        prefix: this.config.prefix,
      });
    }
    return this.queue;
  }
}
