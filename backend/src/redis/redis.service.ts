import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import RedisImport from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { RedisCommandClient } from './redis.client.js';

// ioredis 同样是 CommonJS 默认导出，NodeNext 下不能直接 new。
const Redis = RedisImport as unknown as new (options: RedisOptions) => RedisCommandClient & {
  on(event: 'error', listener: () => void): void;
  disconnect(): void;
};

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  client: RedisCommandClient | null = null;
  ready = false;
  private started = false;

  constructor(private readonly configService: ConfigService) {}

  async connect(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const host = this.read('REDIS_HOST') || 'localhost';
    const port = Number(this.read('REDIS_PORT') || '6379');
    const redis = new Redis({
      host,
      port,
      lazyConnect: true,
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
    redis.on('error', () => undefined);

    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`PING 返回 ${pong}`);
      }
      this.client = redis;
      this.ready = true;
      this.logger.log(`Redis 已连接 ${host}:${port}`);
    } catch (error) {
      redis.disconnect();
      const reason = error instanceof Error ? error.message : 'unknown';
      const message = `无法连接 Redis（${host}:${port}）：${reason}`;
      if (this.isProduction()) {
        throw new Error(`生产环境${message}，拒绝启动`);
      }
      this.logger.warn(`${message}。OTP 与限流降级为进程内存`);
    }
  }

  private isProduction(): boolean {
    return (this.read('NODE_ENV') || 'development') === 'production';
  }

  private read(key: string): string {
    const value = this.configService.get<string>(key) || process.env[key];
    return typeof value === 'string' ? value.trim() : '';
  }
}
