/**
 * CORS 白名单解析（T161）
 *
 * 本机实际端口：后台 5173、小程序 H5 5174、后端 3100。
 * 踩坑：`localhost` 与 `127.0.0.1` 是**不同 origin**，
 * 只配 localhost 会导致用 127.0.0.1 访问的前端被 CORS 拦掉
 * （本轮租户端 H5 正是因此登录失败）。
 *
 * 环境变量 CORS_ORIGINS 逗号分隔；未配置时回落到本地开发默认值。
 */
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:3000',
];

export function resolveCorsOrigins(raw?: string): string[] {
  if (!raw) return [...DEFAULT_ORIGINS];
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // 配了但全是空白时也应回落到默认值，避免「静默拒绝所有跨域请求」
  return parsed.length > 0 ? parsed : [...DEFAULT_ORIGINS];
}

export { DEFAULT_ORIGINS };
