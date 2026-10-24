import { PrismaService } from '../prisma/prisma.service.js';

export const JOB_SKIPPED = Symbol('JOB_SKIPPED');

export type JobTriggerName = 'CRON' | 'MANUAL' | 'QUEUE';

export interface JobRunOutcome<T> {
  status: 'SUCCESS' | 'PARTIAL' | 'SKIPPED';
  result?: T;
}

export interface JobLock {
  tryWithLock<T>(jobName: string, job: () => Promise<T>): Promise<T | typeof JOB_SKIPPED>;
}

/** 进程内锁，供单测模拟两个实例抢同一任务。 */
export class MemoryJobLock implements JobLock {
  private readonly held = new Set<string>();

  async tryWithLock<T>(jobName: string, job: () => Promise<T>): Promise<T | typeof JOB_SKIPPED> {
    if (this.held.has(jobName)) return JOB_SKIPPED;
    this.held.add(jobName);
    try {
      return await job();
    } finally {
      this.held.delete(jobName);
    }
  }
}

/**
 * PostgreSQL 事务级咨询锁。锁跟随事务连接，任务结束或回滚时自动释放。
 * 任务本体仍走连接池里的其他连接，因此连接池至少要有 2 个连接。
 *
 * 事务 timeout 必须显著大于任务时长：Prisma 交互式事务默认 5s 超时，
 * 到点会回滚并立刻释放咨询锁，而任务本体还在背景跑 —— 「同一任务同时只有一个实例在跑」
 * 就只在头 5 秒成立，且这次运行还会被记成 FAILED（T208）。
 */
const LOCK_TRANSACTION_MAX_WAIT_MS = 10 * 1000;

export class PrismaAdvisoryJobLock implements JobLock {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lockTtlMs: number = 15 * 60 * 1000,
  ) {}

  async tryWithLock<T>(jobName: string, job: () => Promise<T>): Promise<T | typeof JOB_SKIPPED> {
    let acquired = false;
    const result = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('tenant-scheduler'), hashtext(${jobName})) AS locked
      `;
        acquired = rows[0]?.locked === true;
        if (!acquired) return undefined as T;
        return job();
      },
      { timeout: this.lockTtlMs, maxWait: LOCK_TRANSACTION_MAX_WAIT_MS },
    );
    return acquired ? result : JOB_SKIPPED;
  }
}

export type JobStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
export type JobObserver = (jobName: string, status: JobStatus, detail?: unknown) => void;

export class JobRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: JobLock,
    private readonly observer?: JobObserver,
  ) {}

  async run<T>(jobName: string, trigger: JobTriggerName, job: () => Promise<T>): Promise<JobRunOutcome<T>> {
    const record = await this.prisma.jobRun.create({
      data: { jobName, trigger, status: 'RUNNING' },
    });
    try {
      const outcome = await this.lock.tryWithLock(jobName, job);
      if (outcome === JOB_SKIPPED) {
        await this.prisma.jobRun.update({
          where: { id: record.id },
          data: { status: 'SKIPPED', finishedAt: new Date() },
        });
        this.observer?.(jobName, 'SKIPPED');
        return { status: 'SKIPPED' };
      }

      // 子任务有失败但任务本体跑完 → PARTIAL，不再伪装 SUCCESS（ISS-31）
      const failedChildren =
        typeof outcome === 'object' &&
        outcome !== null &&
        Array.isArray((outcome as unknown as { errors?: unknown }).errors) &&
        (outcome as unknown as { errors: unknown[] }).errors.length > 0;
      const status = failedChildren ? 'PARTIAL' : 'SUCCESS';
      await this.prisma.jobRun.update({
        where: { id: record.id },
        data: { status, finishedAt: new Date() },
      });
      this.observer?.(jobName, status, outcome);
      return { status, result: outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.observer?.(jobName, 'FAILED', error);
      await this.prisma.jobRun.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorSummary: message.slice(0, 500),
        },
      });
      throw error;
    }
  }
}
