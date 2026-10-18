---
status: completed
task_id: T193
stage: 优化计划 M3 / OPT-20
priority: P2
model_tier: 强
estimated_hours: 12
branch: feature/T193-admin-token-storage
start_time: 2026-10-16 23:46:00
complete_time: 2026-10-17 00:05:00
handoff: docs/handoff/2026-10-16-T193-管理后台Token存储加固.md
---

# T193: 管理后台 Token 存储加固与安全响应头（OPT-20）

依据优化计划 OPT-20。分支从 `feature/T192-admin-composables` 拉出。

## 目标

1. **管理后台 Token 存储加固**：
   - 将管理后台的 refresh token 改为 HttpOnly Cookie 传输与存储（支持跨域请求携带 `withCredentials: true`），避免 XSS 脚本窃取长期凭据。
   - access token 存储在内存（Pinia UserStore）中，刷新页面时通过 HttpOnly Cookie 静默请求 `/api/auth/refresh` 恢复登录态。
   - 小程序端保持原有的 Storage 机制不受影响。
2. **安全退出与 Cookie 撤销**：
   - 登出（Logout）时清除 HttpOnly refresh_token Cookie，并在服务端销毁会话。
3. **安全响应头部署**：
   - 在后端集成安全响应头中间件（Helmet / Custom Middleware），包含：
     - `Content-Security-Policy` (CSP)
     - `X-Content-Type-Options: nosniff`
     - `Referrer-Policy: strict-origin-when-cross-origin`
     - `X-Frame-Options: SAMEORIGIN` / `DENY`
4. **质量验证**：
   - 后端与前端单元测试通过。
   - 刷新页面与登出全链路行为验证无误。

## 验收标准

- [x] `localStorage` 中不存放任何敏感的 token（长期 refresh token 与短期 access token 均从 localStorage 剥离）
- [x] 刷新页面后通过 HttpOnly cookie 静默刷新保持登录，登出后 cookie 被清除
- [x] 后端响应头包含 CSP、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`
- [x] 后端与前端测试全绿，打包构建成功（后端 671 测试全绿，前端 46 测试全绿，小程序 101 测试全绿，E2E 测试通过，Vite build 通过）
