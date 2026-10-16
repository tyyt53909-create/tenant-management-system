import { Throttle } from '@nestjs/throttler';
import { otpEmailTracker, resolveThrottleLimits } from '../../config/throttle.config.js';

/** 登录、注册、邀请码绑定：每 IP 每分钟。 */
export function AuthThrottle() {
  return Throttle({
    default: {
      limit: () => resolveThrottleLimits().auth.limit,
      ttl: () => resolveThrottleLimits().auth.ttl,
    },
  });
}

/** 发送邮箱验证码：每邮箱每小时。 */
export function OtpEmailThrottle() {
  return Throttle({
    default: {
      limit: () => resolveThrottleLimits().otp.limit,
      ttl: () => resolveThrottleLimits().otp.ttl,
      getTracker: otpEmailTracker,
    },
  });
}
