---
status: completed
task_id: T182
stage: 优化计划 M2 / OPT-09
priority: P1
model_tier: 强
estimated_hours: 16
branch: feature/T182-refresh-rotation
start_time: 2026-10-16 19:50:00
complete_time: 2026-10-16 20:05:00
handoff: docs/handoff/2026-10-16-T182-Refresh-Token轮换.md
---

# T182: Refresh Token 轮换与撤销（OPT-09）

依据优化计划 OPT-09。分支从 `feature/T181-redis-shared-state` 拉出，会话存在 Redis；Redis 不可用时开发环境使用进程内存。

## 行为

- 登录签发的 refresh token 带 `jti` 与 `familyId`，并写入会话存储。
- `POST /auth/refresh` 轮换 refresh token，响应同时返回新的 access token 与 refresh token。
- 已轮换的 refresh token 再次使用时，撤销该用户全部会话。
- `POST /auth/logout` 撤销这枚 refresh token 所在会话族。
- `POST /auth/logout-all` 撤销当前用户全部会话。
- 管理员禁用租客账号时撤销该用户全部会话。
- 后台和小程序保存轮换后的 refresh token。退出登录会调用 `/auth/logout`。

## 验收

- [x] 登出后旧 refresh token 不能再刷新
- [x] 同一枚 refresh token 使用两次后，该用户全部会话失效
- [x] 后台 `request.spec.ts` 与小程序 `refresh-rotation.test.mjs` 覆盖轮换后的新 token
