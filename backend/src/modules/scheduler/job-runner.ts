import { PrismaService } from '../prisma/prisma.service.js';

export const JOB_SKIPPED = Symbol('JOB_SKIPPED');

export type JobTriggerName = 'CRON' | 'MANUAL';

export interface JobRunOutcome<T> {
  status: 'SUCCESS' | 'SKIPPED';
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
 */
export class PrismaAdvisoryJobLock implements JobLock {
  constructor(private readonly prisma: PrismaService) {}

  async tryWithLock<T>(jobName: string, job: () => Promise<T>): Promise<T | typeof JOB_SKIPPED> {
    let acquired = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('tenant-scheduler'), hashtext(${jobName})) AS locked
      `;
      acquired = rows[0]?.locked === true;
      if (!acquired) return undefined as T;
      return job();
    });
    return acquired ? result : JOB_SKIPPED;
  }
}

export class JobRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lock: JobLock,
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
        return { status: 'SKIPPED' };
      }
      await this.prisma.jobRun.update({
        where: { id: record.id },
        data: { status: 'SUCCESS', finishedAt: new Date() },
      });
      return { status: 'SUCCESS', result: outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
