import { randomUUID } from 'node:crypto';
import type { RedisCommandClient } from '../../redis/redis.client.js';

export interface RefreshSession {
  jti: string;
  userId: string;
  familyId: string;
  expiresAt: number;
  status: 'active' | 'rotated';
  replacedBy?: string;
  /** 被轮换的时间戳，用于区分「并发刷新的竞态」与「令牌重放」（T208）。 */
  rotatedAt?: number;
}

/**
 * 轮换结果。
 *
 * 输家必须能拿到 `rotatedAt` 才分得清「刚刚被并发请求轮换」（宽限窗口内的竞态）
 * 与「很久以前被轮换、现在又被使用」（重放）。调用方在 `get` 时读到的旧快照里
 * 没有这个字段 —— 两个并发请求都会在任何人轮换之前读完会话，所以判定基准只能来自
 * 这里（T208 补修）。
 */
export interface RotationResult {
  /** 本次调用是否赢得轮换（赢得方可签发新令牌） */
  rotated: boolean;
  /** 该 jti 被轮换的时刻（毫秒）；从未被轮换则为 0 */
  rotatedAt: number;
}

export interface RefreshSessionStore {
  save(session: RefreshSession): Promise<void>;
  get(jti: string): Promise<RefreshSession | undefined>;
  /**
   * 原子地把 active 会话标记为已轮换（compare-and-set）。
   *
   * `rotated: true` 表示本次调用赢得了轮换；`false` 表示该 jti 已经被别人轮换过
   * （并发刷新或重放），此时 `rotatedAt` 是那次轮换的时刻。原先的「get → 判断 → save」
   * 三步非原子，两个并发请求都会通过判断并各自签发，重放检测形同虚设（T208）。
   */
  rotate(jti: string, replacedBy: string): Promise<RotationResult>;
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

  /** 内存实现天然原子（JS 单线程 + Map 同步读改写）。 */
  async rotate(jti: string, replacedBy: string): Promise<RotationResult> {
    const session = this.sessions.get(jti);
    if (!session || session.expiresAt <= Date.now()) return { rotated: false, rotatedAt: 0 };
    if (session.status !== 'active') return { rotated: false, rotatedAt: session.rotatedAt ?? 0 };
    const rotatedAt = Date.now();
    this.sessions.set(jti, { ...session, status: 'rotated', replacedBy, rotatedAt });
    return { rotated: true, rotatedAt };
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

  /**
   * Redis 上的原子轮换：用 `SET ... NX` 抢一个「已轮换」标记键，
   * 抢到的请求才是赢家（只有它会给旧会话写 rotated 状态并签发新令牌）。
   *
   * 标记键的**值是轮换时刻**：它先于会话本体写入，并发的输家即使在会话本体写回前
   * 读到旧状态，也能从这里拿到真实时刻，不会被误判成重放而撤销整个会话家族（T208 补修）。
   */
  async rotate(jti: string, replacedBy: string): Promise<RotationResult> {
    const session = await this.get(jti);
    if (!session) return { rotated: false, rotatedAt: 0 };
    if (session.status !== 'active') {
      return { rotated: false, rotatedAt: (await this.readRotationTime(jti)) ?? session.rotatedAt ?? 0 };
    }

    const ttl = Math.max(session.expiresAt - Date.now(), 1000);
    const rotatedAt = Date.now();
    const marker = await this.redis.set(this.rotatedMarkerKey(jti), String(rotatedAt), 'PX', ttl, 'NX');
    if (marker !== 'OK') {
      // 竞态输家：标记里已经有赢家写入的时刻
      return { rotated: false, rotatedAt: (await this.readRotationTime(jti)) ?? 0 };
    }

    await this.redis.set(
      this.sessionKey(jti),
      JSON.stringify({ ...session, status: 'rotated', replacedBy, rotatedAt }),
      'PX',
      ttl,
    );
    return { rotated: true, rotatedAt };
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

  /** 轮换赢家标记（SET NX），保证同一 jti 只能被成功轮换一次；值是轮换时刻(ms)。 */
  private rotatedMarkerKey(jti: string): string {
    return `refresh:rotated:${jti}`;
  }

  /** 读轮换标记里的时刻；没有标记返回 null。 */
  private async readRotationTime(jti: string): Promise<number | null> {
    const raw = await this.redis.get(this.rotatedMarkerKey(jti));
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private userKey(userId: string): string {
    return `refresh:user:${userId}`;
  }
}

export function newSessionId(): string {
  return randomUUID();
}
