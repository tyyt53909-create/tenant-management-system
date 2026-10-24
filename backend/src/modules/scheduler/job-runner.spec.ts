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

  it('子任务有失败但任务跑完 → PARTIAL，并通知 observer', async () => {
    const { prisma, runs } = recordingPrisma();
    const seen: string[] = [];
    const runner = new JobRunner(
      prisma as never,
      new MemoryJobLock(),
      (_job, status) => seen.push(status),
    );

    const outcome = await runner.run('daily-jobs', 'MANUAL', async () => ({
      contractsActivated: 1,
      errors: ['逾期检查失败'],
    }));

    expect(outcome.status).toBe('PARTIAL');
    expect(runs[0]).toMatchObject({ status: 'PARTIAL' });
    expect(seen).toEqual(['PARTIAL']);
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
  function lockWith(locked: boolean, ttlMs?: number) {
    const tx = { $queryRaw: vi.fn(async () => [{ locked }]) };
    const prisma = { $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
    return { lock: new PrismaAdvisoryJobLock(prisma as never, ttlMs), prisma };
  }

  it('拿到锁才执行任务', async () => {
    const { lock } = lockWith(true);
    await expect(lock.tryWithLock('daily-jobs', async () => 'done')).resolves.toBe('done');
  });

  it('锁事务超时使用传入的 TTL', async () => {
    const { lock, prisma } = lockWith(true, 123_000);
    await lock.tryWithLock('daily-jobs', async () => 'done');
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 123_000 }),
    );
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
