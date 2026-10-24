const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * 解析 `15m` / `7d` / `30s` 这类带单位时长。
 *
 * 只接受「正整数 + 单位」，避免把 `900` 当成 900 毫秒（jsonwebtoken 对纯数字字符串
 * 按毫秒解释）。格式非法返回 `undefined`，由调用方决定抛错还是回退默认值。
 */
export function parseDurationMs(raw: string | undefined | null): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const match = /^(\d+)([smhdw])$/.exec(raw.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return undefined;
  return amount * UNIT_MS[match[2]];
}

/** 解析时长；格式非法时回退到默认值（仅用于有安全默认值的场景，如 Cookie maxAge）。 */
export function durationMsOr(raw: string | undefined | null, fallbackMs: number): number {
  return parseDurationMs(raw) ?? fallbackMs;
}
