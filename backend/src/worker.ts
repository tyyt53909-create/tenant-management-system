import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { AppModule } from './app.module.js';
import { SchedulerService } from './modules/scheduler/scheduler.service.js';
import { JobsQueueService, SCHEDULER_QUEUE } from './modules/jobs/jobs-queue.service.js';

/**
 * 独立后台任务 Worker（OPS-05 / T278）。
 *
 * 启动：`node dist/worker.js`（或 `npm run start:worker`），环境变量：
 * - `QUEUE_ENABLED=true`     必须；否则直接退出
 * - `PROCESS_ROLE=worker`    Web 进程的 cron 不重复触发
 * - `QUEUE_PREFIX`           必须与 Web 一致
 * - `QUEUE_CONCURRENCY`     Worker 并发
 */
async function bootstrap() {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule);
  const jobs = app.get(JobsQueueService);
  const scheduler = app.get(SchedulerService);
  const config = app.get(ConfigService);

  if (!jobs.enabled) {
    logger.error('QUEUE_ENABLED 未开启，Worker 退出');
    await app.close();
    process.exit(1);
  }

  const worker = new Worker(
    SCHEDULER_QUEUE,
    async (job) => {
      const name = (job.data as { name?: string })?.name;
      if (!name) throw new Error('任务缺少 name');
      logger.log(`开始执行队列任务 ${name}（jobId=${job.id}）`);
      return scheduler.rerun(name, 'QUEUE');
    },
    {
      connection: jobs.connectionOptions(),
      prefix: jobs.queuePrefix(),
      concurrency: jobs.workerConcurrency(),
    },
  );

  worker.on('failed', (job, error) => {
    logger.error(
      `队列任务失败 jobId=${job?.id ?? 'unknown'} attempts=${job?.attemptsMade ?? 0}：${error.message}`,
    );
  });
  worker.on('error', (error) => {
    logger.error(`Worker 连接错误：${error.message}`);
  });
  logger.log(`Worker 已启动（prefix=${jobs.queuePrefix()}，queue=${SCHEDULER_QUEUE}）`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`收到 ${signal}，停止 Worker…`);
    await worker.close();
    await app.close();
    logger.log('Worker 已退出');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // 避免 TS 认为 config 未使用；同时把运行角色写进日志，便于排查重复 cron
  logger.log(`PROCESS_ROLE=${config.get<string>('PROCESS_ROLE') ?? 'web'}`);
}

void bootstrap().catch((error: unknown) => {
  new Logger('Worker').error(`Worker 启动失败：${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
