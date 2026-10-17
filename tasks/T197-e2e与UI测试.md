---
status: completed
task_id: T197
stage: 优化计划 M4 / OPT-24
priority: P1
model_tier: 强
estimated_hours: 20
branch: feature/T197-e2e-playwright
start_time: 2026-10-17
complete_time: 2026-10-17
handoff: docs/handoff/2026-10-17-T197-e2e与UI测试.md
---

# T197: e2e 接入 CI + 后台关键流程 UI 测试（OPT-24）

依据优化计划 OPT-24。分支从 `feature/T196-coverage-gate` 拉出。

## 现状

- `scripts/e2e-mvp/run.mjs`（810 行，27 断言：14 步主流程 + 越权/幂等/并发）只能手动跑，需已启动后端 + 种子数据 + 有效 INVITE_CODE。
- `backend/test/*.e2e-spec.ts`（app + authorization）有 `test:e2e` 脚本，但 backend-ci 未执行。
- `frontend-admin` 无浏览器级测试，无 Playwright。

## 目标

1. 新建 `.github/workflows/e2e-ci.yml`：
   - job `backend-e2e`：Postgres + Redis services → `npm ci` → prisma generate → migrate deploy → seed → 启动后端（NODE_ENV=test）→ 管理员登录签发邀请码（POST /auth/invite-codes，解决 seed 时间戳邀请码过期问题）→ 跑 `test:e2e` + `run.mjs`。
   - job `admin-ui`：同上起后端 → 构建管理后台 → preview 静态服务 → `playwright install chromium` → 跑 5 条关键流程 → 失败上传截图 + trace（artifact）。
   - 两个 job 均为 develop/main PR 必需检查（branch protection 需人工在 GitHub 勾选，见遗留）。
2. `frontend-admin/e2e/` Playwright 5 条流程（共用登录 fixture）：
   1. 登录（账号密码进运营中心）
   2. 建房源 → 签合同
   3. 生成账单 → 收款
   4. 批量抄表 → 结算
   5. 退租结算
3. 稳定性：workers=1、失败重试 1 次、失败截图 + trace；本地连续 3 次全绿（10 次为目标，CI 用重试兜底）。

## 验收标准

- [ ] 改 `backend/**`、`scripts/e2e-mvp/**` 的 PR 自动跑 backend-e2e，失败阻断
- [ ] 改 `frontend-admin/**` 的 PR 自动跑 admin-ui，失败阻断
- [ ] 5 条 Playwright 流程本地连续 3 次全绿
- [ ] 失败时有截图 + trace artifact 可下载
- [ ] 现有 CI（backend-ci/admin-ci 等）不受影响

## 分工

- 主线程：workflow、CI 助脚本、playwright config + fixture + 5 specs、本地验证、文档/提交
- 子智能体 A：映射流程 1~3 的 UI 选择器 + 接口契约（只读，不写代码）
- 子智能体 B：映射流程 4~5 的 UI 选择器 + 接口契约（只读，不写代码）

## 本地验证环境（2026-10-17 实测）

- 中文路径 checkout 下 `nest start` 必崩：swagger 插件生成 `u79DF…` 绝对导入。本地跑后端必须用 ASCII worktree（`../tenant-system-worktrees/T197-e2e`，detached，node_modules/.env 软链），Node 用 nvm v22（本机无 Node 20）。
- 本地后端限流会误杀高频登录（默认 auth 10次/分钟）：启动时内联 `THROTTLE_GLOBAL_LIMIT=10000 THROTTLE_AUTH_LIMIT=1000`（与 CI 的 NODE_ENV=test 等效）。不得写 backend/.env（工具保护）。
- refresh token 单次轮换 + 复用即吊销全家：Playwright 各 spec 必须独立登录，禁止复用 storageState 登录态。
- UI 测试跑 vite dev（5173，同源 /api 代理），不用 preview（跨域会撞 CSP connect-src）。
- Playwright APIRequestContext：baseURL 必须以 `/` 结尾且调用用相对路径（无前导 `/`），否则 /api 段被 WHATWG 合并丢掉。

## 开发信息

- 分支: feature/T197-e2e-playwright
- 状态: in_progress
