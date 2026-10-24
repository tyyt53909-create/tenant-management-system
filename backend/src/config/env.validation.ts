import { resolveFieldKey } from '../common/crypto/field-crypto.js';
import { APP_ENVS, ENV_FIELDS, type AppEnv } from './env.schema.js';

const INSECURE_JWT_SECRETS = new Set(['your-jwt-secret-change-this-in-production']);

export interface EnvCheck {
  errors: string[];
  warnings: string[];
}

/**
 * 一次校验全部环境变量。错误只包含变量名与规则，不包含实际值，避免把密钥写进日志。
 * 生产/预发缺一个必填项就拒绝启动；development/test 只警告。
 */
export function checkEnvironment(env: Record<string, unknown>): EnvCheck {
  const rawNodeEnv = read(env, 'NODE_ENV') || 'development';
  const appEnv = isAppEnv(rawNodeEnv) ? rawNodeEnv : 'production';
  const productionLike = appEnv === 'production' || appEnv === 'staging';
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isAppEnv(rawNodeEnv)) {
    errors.push(`NODE_ENV 必须是 ${APP_ENVS.join(' / ')} 之一`);
  }

  for (const field of ENV_FIELDS) {
    if (field.key === 'NODE_ENV') continue;
    const value = read(env, field.key);
    const required = field.requiredIn?.includes(appEnv) === true;

    if (!value) {
      if (required) {
        errors.push(`缺少环境变量 ${field.key}（${field.description}）`);
      } else if (field.requiredIn?.some((item) => item === 'production' || item === 'staging')) {
        warnings.push(`未设置环境变量 ${field.key}（${field.description}）；生产/预发必填`);
      }
      continue;
    }

    const problem = field.validate?.(value);
    if (problem) {
      const message = `环境变量 ${field.key} ${problem}`;
      // 开发/测试保持宽松：格式问题只警告；生产/预发一律拒绝启动。
      if (productionLike) errors.push(message);
      else warnings.push(message);
    }
  }

  const jwtSecret = read(env, 'JWT_SECRET');
  if (jwtSecret && INSECURE_JWT_SECRETS.has(jwtSecret)) {
    const message = '环境变量 JWT_SECRET 仍是示例默认值';
    if (productionLike) errors.push(message);
    else warnings.push(message);
  }
  // docs/12 要求 ≥32 字节随机串；过短的密钥可被暴力/字典攻击，生产/预发直接拒绝启动。
  if (jwtSecret && Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    const message = '环境变量 JWT_SECRET 长度不足 32 字节（docs/12 要求 ≥32 字节随机串）';
    if (productionLike) errors.push(message);
    else warnings.push(message);
  }

  const encryptionKey = read(env, 'ENCRYPTION_KEY');
  if (!encryptionKey && read(env, 'FIELD_ENCRYPTION_KEY')) {
    warnings.push('仅设置了 FIELD_ENCRYPTION_KEY（旧名），建议改用 ENCRYPTION_KEY');
  }

  if (productionLike && !read(env, 'REDIS_URL') && !read(env, 'REDIS_HOST')) {
    errors.push('缺少 REDIS_URL 或 REDIS_HOST（生产/预发必须配置 Redis）');
  }

  for (const key of ['ADMIN_PASSWORD', 'CLEANER_PASSWORD'] as const) {
    if (productionLike && read(env, key)) {
      errors.push(`生产/预发进程禁止设置 ${key}；初始账号请用一次性 bootstrap 命令创建`);
    }
  }

  for (const key of ['OTP_DEV_BYPASS', 'GOOGLE_AUTH_MOCK', 'FEATURE_METER_SIMULATOR'] as const) {
    if (productionLike && read(env, key) === 'true') {
      errors.push(`生产/预发环境禁止 ${key}=true`);
    }
  }

  if (read(env, 'STORAGE_DRIVER') === 's3') {
    const missing = ['OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'].filter(
      (key) => !read(env, key),
    );
    if (missing.length > 0) {
      const message = `STORAGE_DRIVER=s3 但缺少 ${missing.join('、')}`;
      if (productionLike) errors.push(message);
      else warnings.push(message);
    }
  }

  if (!read(env, 'SMTP_HOST') || !read(env, 'SMTP_USER') || !read(env, 'SMTP_PASS')) {
    warnings.push('未设置可选项 SMTP_HOST、SMTP_USER、SMTP_PASS，邮箱验证码无法外发');
  }
  if (!read(env, 'GOOGLE_CLIENT_ID')) warnings.push('未设置可选项 GOOGLE_CLIENT_ID');
  if (!read(env, 'UPLOAD_DIR')) warnings.push('未设置可选项 UPLOAD_DIR，将使用默认 uploads 目录');

  return { errors, warnings };
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const { errors, warnings } = checkEnvironment(config);
  for (const warning of warnings) {
    console.warn(`[env] ${warning}`);
  }
  if (errors.length > 0) {
    throw new Error(`环境变量校验失败，拒绝启动：\n- ${errors.join('\n- ')}`);
  }
  return config;
}

export function isEncryptionKeyValid(value: string): boolean {
  try {
    resolveFieldKey(value);
    return true;
  } catch {
    return false;
  }
}

function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVS as readonly string[]).includes(value);
}

function read(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}
