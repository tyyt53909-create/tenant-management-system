import { randomBytes, randomInt } from 'node:crypto';

/** 生成固定长度的数字串（允许首位为 0）。 */
export function randomDigits(length: number): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError('length 必须是正整数');
  }
  let digits = '';
  for (let index = 0; index < length; index += 1) {
    digits += String(randomInt(0, 10));
  }
  return digits;
}

/**
 * 生成 6 位登录验证码。
 *
 * 使用 `crypto.randomInt` 而不是 `Math.random()`：后者是可预测的伪随机数，
 * 攻击者拿到少量样本即可推算后续验证码（ISS-10）。
 */
export function randomOtpCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

/** 生成大写十六进制随机串（长度为 `byteLength * 2`），用于邀请码等一次性凭据。 */
export function randomHex(byteLength: number): string {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new RangeError('byteLength 必须是正整数');
  }
  return randomBytes(byteLength).toString('hex').toUpperCase();
}
