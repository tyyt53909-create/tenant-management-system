---
status: completed
task_id: T188
stage: 优化计划 M3 / OPT-15
priority: P1
model_tier: 强
estimated_hours: 20
branch: feature/T188-openapi
start_time: 2026-10-16 21:00:00
complete_time: 2026-10-16 21:25:00
handoff: docs/handoff/2026-10-16-T188-OpenAPI与前端类型生成.md
---

# T188: OpenAPI 文档与前端类型自动生成（OPT-15）

依据优化计划 OPT-15。分支从 `feature/T187-extension-points` 拉出。

## 行为

- 集成 `@nestjs/swagger` 与 CLI 插件，自动解析 DTO 生成 OpenAPI 3.0 文档。
- 生成包含 118 条路由的 `backend/openapi.json`，补充 Bearer 认证要求和统一 ErrorBody 模型。
- 使用 `openapi-typescript` 自动生成前端管理后台类型 `frontend-admin/src/types/api.generated.ts`，重构 `frontend-admin/src/types/index.ts` 移除手写 DTO。
- 在 `backend/package.json` 提供 `openapi:generate` 和 `openapi:check` 命令。
- CI 增加 `openapi:check` 门禁，防止后端 DTO 与 OpenAPI 文档漂移。
- 更新 `docs/05-接口规范.md` 指向 OpenAPI 作为唯一事实来源。

## 验收

- [x] 所有 85+ 路由均出现在 OpenAPI 中，含请求/响应结构和鉴权要求（实际 118 条）
- [x] 管理后台手写接口 DTO 替换为生成的类型，`vue-tsc` 和 `npm run build` 全绿
- [x] 改动 DTO 未重新生成 openapi.json 时 CI 检查失败（`openapi:check`）
- [x] `docs/05-接口规范.md` 改为指向 OpenAPI，只保留约定类说明
