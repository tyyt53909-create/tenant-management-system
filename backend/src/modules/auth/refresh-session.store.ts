import { randomUUID } from 'node:crypto';
import type { RedisCommandClient } from '../../redis/redis.client.js';

export interface RefreshSession {
  jti: string;
  userId: string;
  familyId: string;
  expiresAt: number;
  status: 'active' | 'rotated';
  replacedBy?: string;
}

export interface RefreshSessionStore {
  save(session: RefreshSession): Promise<void>;
  get(jti: string): Promise<RefreshSession | undefined>;
  revokeFamily(userId: string, familyId: string): Promise<void>;
  revokeUser(userId: string): Promise<void>;
}

export const REFRESH_STORE = Symbol('REFRESH_STORE');

export class MemoryRefreshSessionStore implements RefreshSessionStore {
  private readonly sessions = new Map<string, RefreshSession>();
  private readonly users = new Map<string, Set<string>>();

  async save(session: RefreshSession): Promise<void> {
    this.sessions.set(session.jti, session);
    const owned = this.users.get(session.userId) ?? new Set<string>();
    owned.add(session.jti);
    this.users.set(session.userId, owned);
  }

  async get(jti: string): Promise<RefreshSession | undefined> {
    const session = this.sessions.get(jti);
    if (!session || session.expiresAt <= Date.now()) return undefined;
    return session;
  }

  async revokeFamily(userId: string, familyId: string): Promise<void> {
    for (const jti of this.users.get(userId) ?? []) {
      const session = this.sessions.get(jti);
      if (session?.familyId === familyId) this.sessions.delete(jti);
    }
  }

  async revokeUser(userId: string): Promise<void> {
    for (const jti of this.users.get(userId) ?? []) this.sessions.delete(jti);
    this.users.delete(userId);
  }
}

export class RedisRefreshSessionStore implements RefreshSessionStore {
  constructor(private readonly redis: RedisCommandClient) {}

  async save(session: RefreshSession): Promise<void> {
    const ttl = Math.max(session.expiresAt - Date.now(), 1000);
    await this.redis.set(this.sessionKey(session.jti), JSON.stringify(session), 'PX', ttl);
    const owned = await this.readUser(session.userId);
    if (!owned.includes(session.jti)) owned.push(session.jti);
    // 轮换时会再写入即将过期的旧会话。用户索引要保留更长的那次 TTL，否则新会话还在，撤销却找不到它。
    const currentTtl = await this.redis.pttl(this.userKey(session.userId));
    const indexTtl = Math.max(ttl, currentTtl > 0 ? currentTtl : 0);
    await this.redis.set(this.userKey(session.userId), JSON.stringify(owned), 'PX', indexTtl);
  }

  async get(jti: string): Promise<RefreshSession | undefined> {
    const raw = await this.redis.get(this.sessionKey(jti));
    if (!raw) return undefined;
    const session = JSON.parse(raw) as RefreshSession;
    if (session.expiresAt <= Date.now()) return undefined;
    return session;
  }

  async revokeFamily(userId: string, familyId: string): Promise<void> {
    const owned = await this.readUser(userId);
    const kept: string[] = [];
    for (const jti of owned) {
      const session = await this.get(jti);
      if (session?.familyId === familyId) {
        await this.redis.del(this.sessionKey(jti));
      } else if (session) {
        kept.push(jti);
      }
    }
    await this.redis.set(this.userKey(userId), JSON.stringify(kept), 'PX', 7 * 24 * 60 * 60 * 1000);
  }

  async revokeUser(userId: string): Promise<void> {
    for (const jti of await this.readUser(userId)) {
      await this.redis.del(this.sessionKey(jti));
    }
    await this.redis.del(this.userKey(userId));
  }

  private async readUser(userId: string): Promise<string[]> {
    const raw = await this.redis.get(this.userKey(userId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  private sessionKey(jti: string): string {
    return `refresh:jti:${jti}`;
  }

  private userKey(userId: string): string {
    return `refresh:user:${userId}`;
  }
}

export function newSessionId(): string {
  return randomUUID();
}
