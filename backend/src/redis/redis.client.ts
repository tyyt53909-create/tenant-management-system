export interface RedisCommandClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    condition?: 'NX',
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ttlMs: number): Promise<number>;
  pttl(key: string): Promise<number>;
  /** Redis EVAL。numKeys 之後先是 keys，再是 args。 */
  eval(script: string, numKeys: number, ...rest: string[]): Promise<unknown>;
  ping(): Promise<string>;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  /** 立即断开（QUIT 失败时的兜底）；测试替身可以不实现。 */
  disconnect?(): void;
}
