---
status: active
owner_tier: medium
applies_to:
  - backend/src/modules/auth/**
  - frontend-admin/src/utils/request.ts
  - miniprogram/utils/request.js
last_verified: 2026-10-16
verified_commit: 79bc9f8
supersedes: null
superseded_by: null
version: 1.0
---

# 交接记录：T182-Refresh Token轮换

---
日期: 2026-10-16
任务: T182 / OPT-09
状态: completed
---

## 完成内容

- Refresh Token 每次刷新都轮换。旧 token 再使用会撤销该用户全部会话。
- 新增 `POST /auth/logout` 与 `POST /auth/logout-all`。管理员禁用租客账号时清掉会话。
- 会话存在 Redis。开发环境连不上 Redis 时用进程内存。没有新增数据表。
- 后台和小程序会保存轮换后的 refresh token，退出登录时通知服务端撤销。

## 验证

- 后端单测 55 个文件、621 项通过。oxlint 0 error。
- 小程序 `npm test` 99 项通过。
- 后台 `src/utils/request.spec.ts` 6 项通过。

## 下一步

OPT-10：定时任务多实例锁、JobRun，以及超过 180 天的通知清理。

## 未做

- 未推送，未开 PR。
- 并发的两次刷新没有加锁。顺序使用已由单测覆盖。
- 未在已登录的浏览器里点击退出。
