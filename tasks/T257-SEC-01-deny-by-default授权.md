---
status: completed
execution_status: completed
task_id: T257
plan_ref: SEC-01
stage: M1
priority: P0
model_tier: 强
branch: feature/T257-sec-01
start_time: 2026-10-23
complete_time: 2026-10-23
merge_commit: f82defd
blocked_by:
depends_on:
acceptance_evidence: tasks/evidence/T257.md
handoff: docs/handoff/2026-10-23-T257-deny-by-default.md
---

# T257：全域 deny-by-default 授权 + 路由策略快照（SEC-01）

## 背景

`JwtAuthGuard` 此前是 opt-in：控制器必须自己写 `@UseGuards(JwtAuthGuard)`，漏写就完全公开。ISS-08 指出的正是这个风险——新增控制器只要忘记注解，接口在无 Token 下也能访问；`RolesGuard` 同样只在显式使用时才校验角色。`docs/19` 将 SEC-01 列为 M1 P0，要求全域默认拒绝并用快照锁住路由策略。

## 范围

- 新增 `@Public()` 装饰器（`IS_PUBLIC_KEY`），作为唯一的公开路由声明方式。
- `JwtAuthGuard` 注入 `Reflector`，类或方法标注 `@Public()` 时跳过 passport，否则交给 JWT 策略校验。
- `AppModule` 通过 `APP_GUARD` 全局注册 `JwtAuthGuard` 与 `RolesGuard`，顺序为「限流 → JWT → 角色」。
- 标注现有公开面：`AppController`、`HealthController`、`PublicController`、`PublicSpaceController`，以及认证控制器的 register/login/refresh/logout/google/client-id/google/send-email-code/login-email-code。
- 新增 `route-policy.spec.ts`：静态解析全部控制器，导出 `method / path / public / roles`，与 `backend/test/route-policy.snapshot.json`（141 条路由）比对；公开路由另有一份显式白名单（16 条）。
- 新增 `jwt-auth.guard.spec.ts`（公开/受保护分支）与 `test/deny-by-default.e2e-spec.ts`（真实 passport 策略下，未注解路由无 Token 返回 401、`@Public()` 返回 200、角色不符 403）。
- 更新 `docs/03-权限矩阵.md` §5.4，记录全局守卫与快照维护方式。

## 非目标

- 不删除控制器上遗留的 `@UseGuards(JwtAuthGuard, RolesGuard)`：保留为纵深防御，行为不变。
- 不改 JWT 签发/刷新/撤销逻辑（归 SEC-02）。
- 不改 OTP、注册策略与 UserIdentity（归 SEC-03 / SEC-04）。
- 不为所有路由补充 `@Roles()`：默认拒绝只保证「必须登录」，角色粒度按现有矩阵逐步补齐。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | 未标注 `@Public()` 的路由无 Token 返回 401 | `test/deny-by-default.e2e-spec.ts` |
| 2 | `@Public()`（类或方法）无 Token 返回 200 | 同上 + `jwt-auth.guard.spec.ts` |
| 3 | 全局守卫顺序为 限流 → JWT → 角色 | `route-policy.spec.ts` |
| 4 | 路由策略快照覆盖全部控制器且无重复 | 同上（141 条） |
| 5 | 公开路由与显式白名单完全一致，且不得声明 `@Roles()` | 同上（16 条） |
| 6 | 现有 e2e/单元测试不回归 | `npm test`、`npm run test:e2e` |
| 7 | lint / tsc 通过 | `npm run lint && npx tsc --noEmit` |

## 文件归属

- `backend/src/common/decorators/public.decorator.ts`（新增）
- `backend/src/common/guards/jwt-auth.guard.ts`、`jwt-auth.guard.spec.ts`（新增）、`route-policy.spec.ts`（新增）
- `backend/test/route-policy.snapshot.json`（新增）、`backend/test/deny-by-default.e2e-spec.ts`（新增）
- `backend/src/app.module.ts`、`backend/src/app.controller.ts`
- `backend/src/modules/auth/auth.controller.ts`
- `backend/src/modules/health/health.controller.ts`
- `backend/src/modules/public/public.controller.ts`
- `backend/src/modules/space/space.controller.ts`
- `docs/03-权限矩阵.md`、`docs/19-生产化路线图.md`、`docs/INDEX.md`

## 开发信息

- 分支：`feature/T257-sec-01`
- 工作树：`/home/user/development/worktrees/tenant-management-system/T257-sec-01`
- 基线：`0bae3be`（`origin/develop`，含 T256）
- 模型：DeepSeek V4.1 Flash
- 开始日期：2026-10-23
- 完成日期：2026-10-23
- 合并：PR #62，merge commit `f82defd`
- 状态：completed

## 风险

- 全局守卫会让「漏注解的控制器」从公开变为 401；本项目现有控制器均已覆盖，公开面已逐一标注，e2e 已验证。
- 路由快照是静态解析（TypeScript AST），不覆盖动态注册的路由；当前项目无动态路由。
- 公开路由白名单变更必须人工确认，避免把业务接口误标为 `@Public()`。
