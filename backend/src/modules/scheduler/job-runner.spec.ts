import { describe, expect, it, vi } from 'vitest';
import {
  JOB_SKIPPED,
  JobRunner,
  MemoryJobLock,
  PrismaAdvisoryJobLock,
} from './job-runner.js';

function recordingPrisma() {
  const runs: Array<Record<string, unknown>> = [];
  const prisma = {
    jobRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${runs.length + 1}`, ...data };
        runs.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = runs.find((item) => item.id === where.id);
        Object.assign(row ?? {}, data);
        return row;
      }),
    },
    $transaction: vi.fn(),
  };
  return { prisma, runs };
}

describe('JobRunner', () => {
  it('两个实例同时触发时，只有一个执行，另一个记为 SKIPPED', async () => {
    const { prisma, runs } = recordingPrisma();
    const lock = new MemoryJobLock();
    const runner = new JobRunner(prisma as never, lock);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let executions = 0;

    const first = runner.run('monthly-bill-generation', 'CRON', async () => {
      executions += 1;
      await gate;
      return { generated: 1 };
    });
    const second = runner.run('monthly-bill-generation', 'CRON', async () => {
      executions += 1;
      return { generated: 2 };
    });

    await expect(second).resolves.toEqual({ status: 'SKIPPED' });
    expect(executions).toBe(1);
    release();
    await expect(first).resolves.toEqual({ status: 'SUCCESS', result: { generated: 1 } });
    expect(executions).toBe(1);
    expect(runs.map((run) => String(run.status)).sort((a, b) => a.localeCompare(b))).toEqual(['SKIPPED', 'SUCCESS']);
  });

  it('任务失败时记录错误摘要', async () => {
    const { prisma, runs } = recordingPrisma();
    const runner = new JobRunner(prisma as never, new MemoryJobLock());

    await expect(runner.run('daily-jobs', 'MANUAL', async () => {
      throw new Error('db down');
    })).rejects.toThrow('db down');

    expect(runs[0]).toMatchObject({ status: 'FAILED', errorSummary: 'db down' });
    expect(runs[0]?.finishedAt).toBeInstanceOf(Date);
  });
});

describe('PrismaAdvisoryJobLock', () => {
  function lockWith(locked: boolean) {
    const tx = { $queryRaw: vi.fn(async () => [{ locked }]) };
    const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
    return { lock: new PrismaAdvisoryJobLock(prisma as never), prisma };
  }

  it('拿到锁才执行任务', async () => {
    const { lock } = lockWith(true);
    await expect(lock.tryWithLock('daily-jobs', async () => 'done')).resolves.toBe('done');
  });

  it('没拿到锁时不执行任务', async () => {
    const { lock } = lockWith(false);
    let ran = false;
    const outcome = await lock.tryWithLock('daily-jobs', async () => {
      ran = true;
      return 'done';
    });
    expect(outcome).toBe(JOB_SKIPPED);
    expect(ran).toBe(false);
  });
});
