-- OPS-05 / T278：JobTrigger 增加 QUEUE（由 Worker 消费）。
ALTER TYPE "JobTrigger" ADD VALUE IF NOT EXISTS 'QUEUE';
