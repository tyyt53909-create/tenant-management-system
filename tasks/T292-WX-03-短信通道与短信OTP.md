---
status: completed
execution_status: completed
task_id: T292
plan_ref: WX-03
stage: M3
priority: P2
model_tier: 普通
branch: feature/T292-sms-otp
merge_commit: 562627c
start_time: 2026-10-25
completed_time: 2026-10-25
blocked_by:
depends_on: COM-01, SEC-03
acceptance_evidence: tasks/evidence/T292.md
handoff: docs/handoff/2026-10-25-T292-短信通道与短信OTP.md
---

# T292：短信通道与短信 OTP（WX-03）

## 背景与目标

根据生产化路线图（docs/19 §4/§5 里程碑 M3），为租客与管理端提供国内手机号短信通道能力（SMS 通道）及手机验证码（OTP）快速登录/绑定服务，解决部分租客未绑定微信或偏好使用手机号验证码进行安全认证的场景。

本任务依托通知中心（`NotificationDispatcher`）及认证系统已有的防刷限流与 OTP 凭据哈希架构（`OtpStore`、HMAC-SHA256、盐与常量时间比对）：
1. **短信提供商架构（`SmsProvider`）**：
   - 抽象通用短信下发接口 `SmsProvider`。
   - 实现 `AliyunSmsProvider`（支持国内阿里云短信开放服务标准签名与模板下发）。
   - 实现 `MockSmsProvider`（在 `SMS_MOCK=true` 或未配置真实云凭证时提供自洽模拟下发，控制台输出验证码，支持本地开发与自动化 CI 门禁运行）。
2. **短信通知渠道（`SmsChannel`）**：
   - 实现 `SmsChannel` 接入通知调度器 `NotificationDispatcher`，渠道名 `sms`。
   - 自动获取用户的真实手机号；无手机号时优雅跳过，不阻断站内信、邮件与微信渠道。
3. **短信验证码服务（`SmsOtpService`）**：
   - 严格校验国内 11 位有效手机号格式（`/^1[3-9]\d{9}$/`）。
   - 存储层采用与 Email OTP 一致的安全加固：加盐 HMAC-SHA256 摘要存储，禁止数据库/缓存明文存储验证码。
   - 具备 60 秒冷却（防刷频）、5 分钟有效期、单验证码最多 5 次错误尝试熔断机制。
   - 在 `OTP_DEV_BYPASS=true` 且 `NODE_ENV=development` 时支持万能码 `123456`，提供测试种子注入函数 `seedCodeForTests`。
4. **认证端点与账号绑定**：
   - `POST /auth/send-sms-code`：发送短信验证码（受 IP/手机号限流保护）。
   - `POST /auth/login-sms-code`：手机短信验证码登录（新手机号带邀请码自动关联预建租客，已注册手机号直接登录签发 JWT）。
   - `POST /auth/bind-phone-sms`：登录用户绑定手机号。
5. **客户端接口与单元测试**：
   - 小程序端 `miniprogram/api/auth.js` 导出短信验证码相关接口与测试覆盖。
   - 提供单元测试与真实 PostgreSQL 数据库集成测试，全量门禁通过。

## 验收标准

- [x] 实现 `SmsProvider` 接口与 `AliyunSmsProvider` / `MockSmsProvider`，支持 `SMS_MOCK=true` 模拟模式。
- [x] 实现 `SmsChannel` 并注册入 `NotificationDispatcher`，支持渠道名 `sms`，无手机号时优雅跳过。
- [x] 实现 `SmsOtpService`：支持 11 位手机号校验、60 秒冷却、5 分钟 TTL、5 次防爆破、HMAC 加盐摘要。
- [x] 后端暴露 `POST /auth/send-sms-code`、`POST /auth/login-sms-code` 与 `POST /auth/bind-phone-sms` 接口。
- [x] 环境变量 `ALIYUN_SMS_*` 与 `SMS_MOCK` 在 schema、env.example 与文档中完整登记并通过一致性检查。
- [x] 小程序端封装短信 API 并通过测试与类型检查。
- [x] 单元测试与真实 PostgreSQL 集成测试全绿，OpenAPI 路由与策略快照同步。
