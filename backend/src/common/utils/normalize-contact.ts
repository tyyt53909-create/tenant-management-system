/**
 * 邮箱/手机号规范化已收敛到共享包（QLT-04 / T289），此处保留 re-export 兼容既有 import。
 */
export { normalizeEmail, normalizePhone } from '../../../../shared/src/contact.js';
