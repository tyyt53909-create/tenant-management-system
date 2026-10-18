const PRODUCTION_REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'] as const;

const INSECURE_JWT_SECRETS = new Set(['your-jwt-secret-change-this-in-production']);

export interface EnvCheck {
  errors: string[];
  warnings: string[];
}

export function checkEnvironment(env: Record<string, unknown>): EnvCheck {
  const nodeEnv = read(env, 'NODE_ENV') || 'development';
  const production = nodeEnv === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of PRODUCTION_REQUIRED) {
    if (!read(env, key)) {
      const message = `缺少环境变量 ${key}`;
      if (production) errors.push(message);
      else warnings.push(message);
    }
  }

  const jwtSecret = read(env, 'JWT_SECRET');
  if (jwtSecret && (jwtSecret.length < 32 || INSECURE_JWT_SECRETS.has(jwtSecret))) {
    const message = '环境变量 JWT_SECRET 过短或仍是示例默认值';
    if (production) errors.push(message);
    else warnings.push(message);
  }

  if (!read(env, 'UPLOAD_DIR')) warnings.push('未设置可选项 UPLOAD_DIR，将使用默认 uploads 目录');
  if (!read(env, 'GOOGLE_CLIENT_ID')) warnings.push('未设置可选项 GOOGLE_CLIENT_ID');
  if (!read(env, 'REDIS_HOST')) warnings.push('未设置可选项 REDIS_HOST');
  if (!read(env, 'SMTP_HOST') || !read(env, 'SMTP_USER') || !read(env, 'SMTP_PASS')) {
    warnings.push('未设置可选项 SMTP_HOST、SMTP_USER、SMTP_PASS，邮箱验证码无法外发');
  }
  if (!read(env, 'OSS_ACCESS_KEY_ID') || !read(env, 'OSS_ACCESS_KEY_SECRET')) {
    warnings.push('未设置可选项 OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET');
  }

  return { errors, warnings };
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const { errors, warnings } = checkEnvironment(config);
  for (const warning of warnings) {
    console.warn(`[env] ${warning}`);
  }
  if (errors.length > 0) {
    throw new Error(`生产环境拒绝启动，缺少或无效的环境变量：${errors.join('；')}`);
  }
  return config;
}

function read(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}
