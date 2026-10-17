---
status: completed
task_id: T174
stage: 优化计划 M1 / OPT-01
priority: P0
model_tier: 强
estimated_hours: 8
branch: feature/T174-otp-security
start_time: 2026-10-15 23:40:00
complete_time: 2026-10-15 23:50:00
handoff: docs/handoff/2026-10-15-T174-OTP验证码安全加固.md
---

# T174: OTP 验证码安全加固（OPT-01）

依据 `docs/13-架构与现有代码优化计划.md` 的 OPT-01。不新增业务功能。改变 T170 里「非生产环境一律接受 123456」的行为。

## 范围

- `backend/src/modules/auth/otp-store.ts`：`OtpStore` 接口与内存实现
- `backend/src/modules/auth/email-otp.service.ts`
- `backend/src/modules/auth/email-otp.service.spec.ts`
- `backend/.env.example`、`docs/12-部署与运维.md`

## 行为

- 万能码 `123456` 仅在 `NODE_ENV=development` 且 `OTP_DEV_BYPASS=true` 时通过
- 同一组验证码连续 5 次错误后作废，必须重新发送
- 生产环境未配置 SMTP 时拒绝发送并告警
- 生产环境发信失败时，日志不含本次验证码，该验证码作废

## 验收

- [x] `NODE_ENV` 未设置或不是 development 时，`123456` 失败
- [x] 连续 5 次错误后，第 6 次正确码也失败
- [x] production 发信失败时，日志搜不到 6 位验证码
- [x] 原有邮箱验证码单测保持通过，并新增安全测例（本文件 13 项）
- [x] 后端全量单测 601 通过（51 个文件）
