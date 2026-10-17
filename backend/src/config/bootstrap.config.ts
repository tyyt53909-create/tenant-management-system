import { resolveCorsOrigins } from './cors.config.js';
import { resolveTrustProxy } from './throttle.config.js';

/**
 * 启动期配置（Nest DI 之前就需要的那部分）。
 *
 * `main.ts`、HTTP 日志、全局异常过滤器都在 `ConfigService` 可用之前就要这些值，
 * 所以把 `process.env` 读取集中在这里（config 层），业务代码只拿解析结果。
 * 见 OPT-07「`src/` 中除 config 层外没有 `process.env` 读取」。
 */
export interface BootstrapConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  logLevel: string;
  corsOrigins: string[];
  trustProxy: boolean | number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_LOG_LEVEL = 'info';

export function loadBootstrapConfig(env: NodeJS.ProcessEnv = process.env): BootstrapConfig {
  const nodeEnv = readString(env.NODE_ENV) ?? 'development';
  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: resolvePort(env.PORT),
    logLevel: readString(env.LOG_LEVEL) ?? DEFAULT_LOG_LEVEL,
    corsOrigins: resolveCorsOrigins(env.CORS_ORIGINS),
    trustProxy: resolveTrustProxy(env.TRUST_PROXY, nodeEnv),
  };
}

/** 非法或缺失的端口回退到默认值，避免 `app.listen('abc')` 这类运行时炸开。 */
export function resolvePort(raw?: string): number {
  const value = readString(raw);
  if (value === undefined) return DEFAULT_PORT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return DEFAULT_PORT;
  return parsed;
}

function readString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
