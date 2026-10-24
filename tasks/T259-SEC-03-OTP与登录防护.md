---
status: completed
execution_status: completed
task_id: T259
plan_ref: SEC-03
stage: M1
priority: P0
model_tier: 强
branch: feature/T259-sec-03
start_time: 2026-10-24
complete_time: 2026-10-24
merge_commit: 43bd973
blocked_by:
depends_on: T258
acceptance_evidence: tasks/evidence/T259.md
handoff: docs/handoff/2026-10-24-T259-OTP与登录防护.md
---

# T259：OTP 与登录防护（SEC-03）

## 背景

`docs/19` SEC-03 覆盖两个仍成立的 P0/P1 问题：

- **ISS-10**：邮箱验证码用 `Math.random()` 生成、以明文 JSON 存 Redis、失败次数是「读-改-写」，并发下可绕过 5 次上限。
- **ISS-24**：登录可枚举账号（未知账号与无密码账号的响应不同、耗时不同）、bcrypt cost 固定 10、没有失败锁定。

本轮目标是把验证码与密码登录从「演示可用」提升到「可对外暴露」：验证码不可预测、落盘不存明文、失败计数原子；登录不泄露账号是否存在，并具备可配置的失败锁定。

## 范围

### 1. 验证码生成与存储

- 生成改用 `crypto.randomInt(100000, 1000000)`，不再使用 `Math.random()`。
- `OtpRecord` 不再保存明文 `code`，改为 `{ codeHash, salt, expiresAt, lastSentAt }`。
  - `codeHash = HMAC-SHA256(key, salt + ':' + code)`；`salt` 为每条记录独立的 16 字节随机值。
  - 校验用 `crypto.timingSafeEqual`，避免逐字符比较的时序差异。
  - 密钥取 `OTP_HASH_SECRET`，未设置时回退 `JWT_SECRET`（生产必填，多实例一致）；开发/测试都没有时使用进程内随机密钥并告警。
- 开发模式的 `[DEV OTP]` 日志仍输出本次验证码；生产日志继续脱敏（T174 行为不变）。

### 2. 失败计数原子化

- `OtpStore` 新增 `incrementFailedAttempts(email, ttlMs)`、`getFailedAttempts(email)`、`resetFailedAttempts(email)`。
- Redis 实现使用独立计数器键 + `INCR` + 首次失败 `PEXPIRE`，不再对整条 JSON 做读改写；内存实现同样以计数 Map 保证语义一致。
- 验证码校验失败时只做一次原子自增；达到 `OTP_MAX_FAILED_ATTEMPTS`（5）立即删除验证码与计数器。
- 发送新验证码时重置失败计数。

### 3. 登录防护

- 新增 `LoginAttemptStore`（内存 + Redis 双实现），按规范化 identifier 的 `SHA-256` 计数，避免把邮箱/手机号明文写进 Redis 键。
- 连续失败 `LOGIN_MAX_FAILED_ATTEMPTS`（默认 5）次后锁定 `LOGIN_LOCK_MS`（默认 15 分钟），期间返回 **429**，文案不区分账号是否存在。
- 登录成功立即清零；失败计数窗口 `LOGIN_FAILURE_WINDOW_MS`（默认 15 分钟）。
- 防枚举：
  - 未知账号执行一次 dummy bcrypt 比对，使响应耗时与密码错误同量级。
  - 无密码账号（仅第三方登录）与密码错误统一返回 401「邮箱/手机号或密码错误」。
- bcrypt cost 提升到 `BCRYPT_ROUNDS`（默认 12，允许 10–14）；既有 cost 10 哈希继续可登录。`prisma/seed.ts` 同步使用该配置。
- 邀请码生成同步移除 `Math.random()`，改用 `randomHex`（同属可被爆破的认证凭据，符合 AGENTS §14.4）。

### 4. 配置与文档

- `env.schema.ts` 新增 `OTP_HASH_SECRET`、`LOGIN_MAX_FAILED_ATTEMPTS`、`LOGIN_LOCK_MS`、`LOGIN_FAILURE_WINDOW_MS`、`BCRYPT_ROUNDS`，并同步 `backend/.env.example`、`.env.prod.example`、`docs/12`。
- `docs/05` 补充登录 429 语义；`docs/INDEX.md` 登记任务书与交接记录。

## 非目标

- 自助注册与身份绑定策略（SEC-04）、员工账号生命周期（SEC-05）。
- MFA / TOTP、改密与找回密码（SEC-05）。
- 短信 OTP 与微信订阅消息（WX-03、WX-02）。
- OTP 邮件模板与品牌改版。
- 逐请求 Access Token 撤销列表（T258 已说明）。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | 验证码由密码学安全随机源生成，auth 路径不再出现 `Math.random()` | `grep` + `secure-random.spec.ts` |
| 2 | 存储记录与 Redis 原始值都不含 6 位明文验证码 | `otp-store.spec.ts`、`redis-otp.store.spec.ts` |
| 3 | 并发错误输入下失败计数不丢失；第 6 次即使正确码也失败 | `email-otp.service.spec.ts` 并发用例 |
| 4 | 连续 5 次密码错误后返回 429；窗口过后恢复；成功登录清零 | `auth.service.spec.ts`、`login-attempt.store.spec.ts` |
| 5 | 未知账号 / 无密码账号 / 密码错误的响应状态与文案一致 | `auth.service.spec.ts` |
| 6 | 新哈希 cost 为 12；cost 10 旧哈希仍可登录 | `auth.service.spec.ts` |
| 7 | 全量测试、lint、tsc、e2e、docs-check 通过 | 见 `tasks/evidence/T259.md` |

## 文件归属

- `backend/src/modules/auth/otp-store.ts`、`otp-store.spec.ts`（新增）
- `backend/src/redis/redis-otp.store.ts`、`redis-otp.store.spec.ts`（新增）
- `backend/src/modules/auth/email-otp.service.ts`、`email-otp.service.spec.ts`
- `backend/src/modules/auth/login-attempt.store.ts`、`login-attempt.store.spec.ts`（新增）
- `backend/src/redis/redis-login-attempt.store.ts`、`redis-login-attempt.store.spec.ts`（新增）
- `backend/src/common/utils/secure-random.ts`、`secure-random.spec.ts`（新增）
- `backend/src/config/password.config.ts`、`password.config.spec.ts`（新增）
- `backend/src/config/env.schema.ts`、`env.validation.spec.ts`
- `backend/src/modules/auth/auth.service.ts`、`auth.service.spec.ts`（新增）
- `backend/src/modules/auth/invite-code.service.ts`、`invite-code.service.spec.ts`
- `backend/src/modules/auth/auth.module.ts`
- `backend/prisma/seed.ts`
- `backend/.env.example`、`.env.prod.example`
- `docs/05-接口规范.md`、`docs/12-部署与运维.md`、`docs/19-生产化路线图.md`、`docs/INDEX.md`

## 开发信息

- 分支：`feature/T259-sec-03`
- 基线：`7b923f9`（`origin/develop`，含 T258 合并）
- 模型：DeepSeek V4.1 Flash
- 开始日期：2026-10-24
- 完成日期：2026-10-24
- 合并：PR #66，merge commit `43bd973`
- 状态：completed

## 风险

- 登录锁定可被用来对已知账号做拒绝服务；采用 5 次 / 15 分钟窗口 + 自动解锁，且锁定期间不泄露账号是否存在，后续可在 SEC-05 评估按 IP 与按账号双层策略。
- 提高 bcrypt cost 会增加注册与登录耗时（约 +150ms），需要观察 k6 登录基线；`BCRYPT_ROUNDS` 可在紧急情况下回落到 10。
- `OTP_HASH_SECRET` 未单独配置时回退 `JWT_SECRET`：轮换 JWT 密钥会让未过期的验证码失效（可接受，验证码仅 5 分钟）。
