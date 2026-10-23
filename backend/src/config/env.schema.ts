import { resolveFieldKey } from '../common/crypto/field-crypto.js';

export const APP_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export interface EnvFieldSpec {
  key: string;
  description: string;
  /** 这些运行环境必须显式提供；生产/预发缺一个都拒绝启动。 */
  requiredIn?: readonly AppEnv[];
  /** 仅用于模板生成与审计，不会把值写进日志。 */
  secret?: boolean;
  validate?: (value: string) => string | null;
}

const BOOLEAN_VALUES = ['true', 'false'];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const STORAGE_DRIVERS = ['local', 's3'];

function oneOf(...values: string[]): (value: string) => string | null {
  return (value) => (values.includes(value) ? null : `必须是 ${values.join(' / ')} 之一`);
}

function integerRange(min: number, max: number): (value: string) => string | null {
  return (value) => {
    if (!/^\d+$/.test(value)) return '必须是整数';
    const parsed = Number(value);
    return parsed >= min && parsed <= max ? null : `必须在 ${min}–${max} 之间`;
  };
}

function corsOrigins(value: string): string | null {
  const origins = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (origins.length === 0) return '至少需要一个来源';
  for (const origin of origins) {
    if (origin === '*') return '不允许使用通配符 *';
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return `来源必须是 http/https：${origin}`;
    } catch {
      return `不是合法 URL：${origin}`;
    }
  }
  return null;
}

export function parseRedisUrl(value: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls: boolean;
} | string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return '不是合法 URL';
  }
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) return '协议必须是 redis:// 或 rediss://';
  if (!parsed.hostname) return '缺少主机名';
  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口必须在 1–65535 之间';
  const dbText = parsed.pathname.replace(/^\//, '');
  const db = dbText ? Number(dbText) : 0;
  if (!Number.isInteger(db) || db < 0) return '数据库编号必须是非负整数';
  return {
    host: parsed.hostname,
    port,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db,
    tls: parsed.protocol === 'rediss:',
  };
}

/**
 * 环境变量清单。新增变量时先加到这里，再同步 `.env.example`／`.env.prod.example`；
 * `scripts/check-env-examples.mjs` 会检查模板是否漏项。
 */
export const ENV_FIELDS: readonly EnvFieldSpec[] = [
  {
    key: 'NODE_ENV',
    description: '运行环境：development / test / staging / production',
    validate: oneOf(...APP_ENVS),
  },
  {
    key: 'PORT',
    description: 'HTTP 监听端口',
    validate: integerRange(1, 65535),
  },
  {
    key: 'LOG_LEVEL',
    description: '访问日志级别：debug / info / warn / error',
    validate: oneOf(...LOG_LEVELS),
  },
  {
    key: 'CORS_ORIGINS',
    description: '允许的前端来源，逗号分隔；生产/预发必填，不允许 *',
    requiredIn: ['staging', 'production'],
    validate: corsOrigins,
  },
  {
    key: 'TRUST_PROXY',
    description: '反向代理层数（false / true / 0–10）',
    validate: (value) => {
      if (value === 'false' || value === 'true') return null;
      return integerRange(0, 10)(value);
    },
  },
  {
    key: 'DATABASE_URL',
    description: 'PostgreSQL 连接串',
    requiredIn: ['staging', 'production'],
    secret: true,
    validate: (value) => {
      try {
        const parsed = new URL(value);
        return ['postgres:', 'postgresql:'].includes(parsed.protocol)
          ? null
          : '协议必须是 postgres:// 或 postgresql://';
      } catch {
        return '不是合法 URL';
      }
    },
  },
  {
    key: 'JWT_SECRET',
    description: 'JWT 签名密钥，至少 32 字节',
    requiredIn: ['staging', 'production'],
    secret: true,
    validate: (value) => (value.length >= 32 ? null : '至少 32 个字符'),
  },
  { key: 'JWT_ACCESS_EXPIRY', description: 'Access token 有效期（默认 15m）' },
  { key: 'JWT_REFRESH_EXPIRY', description: 'Refresh token 有效期（默认 7d）' },
  {
    key: 'ENCRYPTION_KEY',
    description: '证件号等字段加密密钥，32 字节（base64 / 64 位 hex / 原文）',
    requiredIn: ['staging', 'production'],
    secret: true,
    validate: (value) => {
      try {
        resolveFieldKey(value);
        return null;
      } catch {
        return '必须是 32 字节，可用 base64、64 位十六进制或 32 字节原文';
      }
    },
  },
  { key: 'FIELD_ENCRYPTION_KEY', description: '旧版加密密钥别名，仅兼容旧部署', secret: true },
  {
    key: 'REDIS_URL',
    description: 'Redis 连接串（优先于 HOST/PORT/密码），支持 redis:// 与 rediss://',
    secret: true,
    validate: (value) => {
      const parsed = parseRedisUrl(value);
      return typeof parsed === 'string' ? parsed : null;
    },
  },
  { key: 'REDIS_HOST', description: 'Redis 主机（未设置 REDIS_URL 时使用，默认 localhost）' },
  {
    key: 'REDIS_PORT',
    description: 'Redis 端口（默认 6379）',
    validate: integerRange(1, 65535),
  },
  { key: 'REDIS_PASSWORD', description: 'Redis 密码（配合 HOST/PORT 使用）', secret: true },
  {
    key: 'REDIS_DB',
    description: 'Redis 数据库编号（默认 0）',
    validate: integerRange(0, 15),
  },
  { key: 'UPLOAD_DIR', description: '本地上传目录（默认 ./uploads）' },
  {
    key: 'STORAGE_DRIVER',
    description: '文件存储：local / s3',
    validate: oneOf(...STORAGE_DRIVERS),
  },
  { key: 'OSS_BUCKET', description: 'OSS/S3 bucket' },
  { key: 'OSS_REGION', description: 'OSS/S3 region' },
  { key: 'OSS_ACCESS_KEY_ID', description: 'OSS/S3 access key id', secret: true },
  { key: 'OSS_ACCESS_KEY_SECRET', description: 'OSS/S3 access key secret', secret: true },
  { key: 'S3_ENDPOINT', description: 'S3 兼容端点（MinIO 等）' },
  {
    key: 'S3_FORCE_PATH_STYLE',
    description: 'S3 是否使用 path-style（MinIO 通常为 true）',
    validate: oneOf(...BOOLEAN_VALUES),
  },
  { key: 'SMTP_HOST', description: 'SMTP 主机；缺失时邮箱验证码无法外发' },
  { key: 'SMTP_PORT', description: 'SMTP 端口（默认 465）', validate: integerRange(1, 65535) },
  { key: 'SMTP_USER', description: 'SMTP 用户名' },
  { key: 'SMTP_PASS', description: 'SMTP 密码', secret: true },
  { key: 'SMTP_FROM', description: '发件人显示名与地址' },
  { key: 'GOOGLE_CLIENT_ID', description: 'Google OAuth Client ID（可选）' },
  {
    key: 'GOOGLE_AUTH_MOCK',
    description: 'Google 模拟登录开关；生产必须为 false',
    validate: oneOf(...BOOLEAN_VALUES),
  },
  {
    key: 'OTP_DEV_BYPASS',
    description: '万能验证码开关；生产必须为 false',
    validate: oneOf(...BOOLEAN_VALUES),
  },
  { key: 'DEFAULT_BUILDING_ID', description: '默认楼栋 ID（导入/公共水电兜底）' },
  { key: 'ADMIN_EMAIL', description: '初始管理员邮箱（seed 用）' },
  {
    key: 'ADMIN_PASSWORD',
    description: '初始管理员密码（仅 seed；生产进程禁止设置）',
    secret: true,
  },
  { key: 'CLEANER_EMAIL', description: '初始保洁邮箱（seed 用）' },
  {
    key: 'CLEANER_PASSWORD',
    description: '初始保洁密码（仅 seed；生产进程禁止设置）',
    secret: true,
  },
  {
    key: 'THROTTLE_GLOBAL_LIMIT',
    description: '全局限流（次/分钟/IP）',
    validate: integerRange(0, 1_000_000),
  },
  {
    key: 'THROTTLE_AUTH_LIMIT',
    description: '认证接口限流（次/分钟/IP）',
    validate: integerRange(0, 1_000_000),
  },
  {
    key: 'THROTTLE_OTP_LIMIT',
    description: 'OTP 发送限流（次/小时/邮箱）',
    validate: integerRange(0, 1_000_000),
  },
  {
    key: 'THROTTLE_OTP_IP_LIMIT',
    description: 'OTP 发送限流（次/小时/IP）',
    validate: integerRange(0, 1_000_000),
  },
  {
    key: 'FEATURE_METER_SIMULATOR',
    description: '虚拟水电表模拟器开关；生产必须为 false',
    validate: oneOf(...BOOLEAN_VALUES),
  },
];

export const ENV_FIELD_KEYS: readonly string[] = ENV_FIELDS.map((field) => field.key);
