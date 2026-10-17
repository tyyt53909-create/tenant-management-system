---
status: completed
task_id: T181
stage: 优化计划 M2 / OPT-08
priority: P1
model_tier: 强
estimated_hours: 12
branch: feature/T181-redis-shared-state
start_time: 2026-10-16 19:40:00
complete_time: 2026-10-16 19:50:00
handoff: docs/handoff/2026-10-16-T181-Redis共享状态.md
---

# T181: 接入 Redis 作为共享状态（OPT-08）

依据优化计划 OPT-08。本分支先汇入 T174 和 T175，再把 OTP 与限流计数放到 Redis。

## 行为

- `RedisOtpStore` 按邮箱保存验证码，并带 TTL。
- `RedisThrottlerStorage` 用 `INCR` 共享限流计数。
- 生产环境连不上 Redis 时拒绝启动。
- 开发环境连不上时降级为进程内存，并写警告。

## 验收

- [x] 两个存储实例读同一份验证码
- [x] 两个限流存储共享计数，第 11 次阻断
- [x] 生产环境连接失败时抛出拒绝启动
- [x] 本机 Redis 上两个独立客户端能读到同一把钥匙和同一个计数
