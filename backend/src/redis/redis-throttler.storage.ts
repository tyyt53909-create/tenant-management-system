import type { ThrottlerStorage } from '@nestjs/throttler';
import type { RedisCommandClient } from './redis.client.js';

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisCommandClient,
    private readonly prefix = 'throttle:',
  ) {}

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string) {
    const redisKey = `${this.prefix}${throttlerName}:${key}`;
    const totalHits = await this.redis.incr(redisKey);
    if (totalHits === 1) {
      await this.redis.pexpire(redisKey, ttl);
    }
    const remainingMs = await this.redis.pttl(redisKey);
    const timeToExpire = Math.max(1, Math.ceil(Math.max(remainingMs, 0) / 1000));
    const isBlocked = totalHits > limit;
    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}
