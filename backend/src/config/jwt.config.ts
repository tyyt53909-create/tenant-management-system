import { registerAs } from '@nestjs/config';
import { parseDurationMs } from '../common/utils/duration.js';

export const DEFAULT_ACCESS_TOKEN_EXPIRY = '15m';
export const DEFAULT_REFRESH_TOKEN_EXPIRY = '7d';

function readExpiry(name: string, fallback: string): string {
  const raw = process.env[name]?.trim() || fallback;
  // 启动即失败，而不是等到签发令牌时抛 500；纯数字（无单位）也拒绝。
  if (parseDurationMs(raw) === undefined) {
    throw new Error(`${name} 格式非法：只接受「正整数 + 单位」，如 15m / 12h / 7d。`);
  }
  return raw;
}

export default registerAs('jwt', () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET 环境变量未设置！这是必需的安全配置。');
  }

  return {
    secret,
    accessTokenExpiry: readExpiry('JWT_ACCESS_EXPIRY', DEFAULT_ACCESS_TOKEN_EXPIRY),
    refreshTokenExpiry: readExpiry('JWT_REFRESH_EXPIRY', DEFAULT_REFRESH_TOKEN_EXPIRY),
  };
});
