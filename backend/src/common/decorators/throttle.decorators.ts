import { Throttle } from '@nestjs/throttler';
import { OTP_EMAIL_THROTTLER_NAME, otpEmailTracker, resolveThrottleLimits } from '../../config/throttle.config.js';

/** 登录、注册、邀请码绑定：每 IP 每分钟。 */
export function AuthThrottle() {
  return Throttle({
    default: {
      limit: () => resolveThrottleLimits().auth.limit,
      ttl: () => resolveThrottleLimits().auth.ttl,
    },
  });
}

/**
 * 发送邮箱验证码：**每邮箱每小时** + **每 IP 每小时** 两层。
 *
 * T206 修正：原先只在 `default` 上挂 `getTracker: otpEmailTracker`，而 throttler 的 guard
 * 每条路由对每个命名限流器只保留一个 tracker，于是按 IP 的全局限流被顶掉，
 * 未登录者换一个邮箱就是一个新桶 —— 可以拿本站对不限数量的收件人寄验证码信。
 * 现在邮箱计数走独立的命名限流器（tracker 由模块配置提供），`default` 保持按 IP。
 */
export function OtpEmailThrottle() {
  return Throttle({
    default: {
      limit: () => resolveThrottleLimits().otpIp.limit,
      ttl: () => resolveThrottleLimits().otpIp.ttl,
    },
    [OTP_EMAIL_THROTTLER_NAME]: {
      limit: () => resolveThrottleLimits().otp.limit,
      ttl: () => resolveThrottleLimits().otp.ttl,
    },
  });
}

export { otpEmailTracker };
