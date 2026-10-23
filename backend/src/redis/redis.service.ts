import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import RedisImport from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { RedisCommandClient } from './redis.client.js';
import {
  describeRedisConnection,
  redisRetryDelay,
  resolveRedisConnection,
} from './redis.config.js';

interface RedisInstance extends RedisCommandClient {
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'ready' | 'close', listener: () => void): void;
  on(event: 'reconnecting', listener: (delay: number) => void): void;
  disconnect(): void;
}

// ioredis 同样是 CommonJS 默认导出，NodeNext 下不能直接 new。
const Redis = RedisImport as unknown as new (options: RedisOptions) => RedisInstance;

const INITIAL_CONNECT_TIMEOUT_MS = 3000;
const QUIT_TIMEOUT_MS = 2000;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  client: RedisCommandClient | null = null;
  ready = false;
  private started = false;

  constructor(private readonly configService: ConfigService) {}

  async connect(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const connection = resolveRedisConnection((key) => this.read(key));
    const target = describeRedisConnection(connection);
    const redis = new Redis({
      ...connection,
      lazyConnect: true,
      connectTimeout: INITIAL_CONNECT_TIMEOUT_MS,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      retryStrategy: redisRetryDelay,
    });

    redis.on('ready', () => {
      this.ready = true;
      this.logger.log(`Redis 已连接 ${target}`);
    });
    redis.on('close', () => {
      this.ready = false;
    });
    redis.on('reconnecting', (delay) => {
      this.ready = false;
      this.logger.warn(`Redis 连接断开，${delay}ms 后重连（${target}）`);
    });
    redis.on('error', (error) => {
      this.ready = false;
      this.logger.error(`Redis 连接错误（${target}）：${error.message}`);
    });

    try {
      const connecting = redis.connect();
      // 超时后底层连接仍可能继续重试；挂一个空 catch，避免未处理的 rejection。
      void connecting.catch(() => undefined);
      await withTimeout(connecting, INITIAL_CONNECT_TIMEOUT_MS);
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`PING 返回 ${pong}`);
      }
      this.client = redis;
      this.ready = true;
    } catch (error) {
      redis.disconnect();
      this.client = null;
      this.ready = false;
      const reason = (error instanceof Error ? error.message : 'unknown').replace(/[.。]+$/, '');
      const message = `无法连接 Redis（${target}）：${reason}`;
      if (this.isProduction()) {
        throw new Error(`生产环境${message}，拒绝启动`);
      }
      this.logger.warn(`${message}。OTP 与限流降级为进程内存`);
    }
  }

  /**
   * 优雅关闭：先 QUIT 让服务端释放连接，最多等 2 秒；失败或超时立即断开。
   * 停机路径不抛错，避免一个连接问题拖住整个进程。
   */
  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.ready = false;
    if (!client) return;

    try {
      await withTimeout(client.quit(), QUIT_TIMEOUT_MS);
      this.logger.log('Redis 连接已关闭');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Redis 关闭时 QUIT 失败（${reason}），改为立即断开`);
      try {
        client.disconnect?.();
      } catch {
        // 已断开或底层已销毁，忽略。
      }
    }
  }

  private isProduction(): boolean {
    return (this.read('NODE_ENV') || 'development') === 'production';
  }

  private read(key: string): string {
    const value = this.configService.get<string>(key);
    return typeof value === 'string' ? value.trim() : '';
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`连接超时（${timeoutMs}ms）`)), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
