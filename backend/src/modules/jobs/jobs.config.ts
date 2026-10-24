export interface JobsConfig {
  enabled: boolean;
  concurrency: number;
  attempts: number;
  backoffMs: number;
  prefix: string;
}

type ReadEnv = (key: string) => string | undefined;

function positiveInt(raw: string | undefined, fallback: number, min = 1): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : fallback;
}

export function loadJobsConfig(read: ReadEnv): JobsConfig {
  return {
    enabled: (read('QUEUE_ENABLED') ?? '').trim().toLowerCase() === 'true',
    concurrency: positiveInt(read('QUEUE_CONCURRENCY'), 2),
    attempts: positiveInt(read('QUEUE_ATTEMPTS'), 3),
    backoffMs: positiveInt(read('QUEUE_BACKOFF_MS'), 5000, 100),
    prefix: (read('QUEUE_PREFIX') ?? 'tenant-jobs').trim() || 'tenant-jobs',
  };
}
