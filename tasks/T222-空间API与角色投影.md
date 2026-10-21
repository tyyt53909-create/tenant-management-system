---
status: in_progress
task_id: T222
stage: 第五阶段（房源空间可视化 / Wave 1）
priority: P1
model_tier: 强
branch: feature/T222-space-api
start_time: 2026-10-21
complete_time: null
handoff: null
---

# T222: 空间 API 与角色投影

## 背景

T220 的 `/space` 目前由前端组合 `GET /buildings` + `GET /rooms`，没有统一的空间契约，也无法保证 CLEANER / TENANT / PUBLIC 的資料投影。

T222 新增 `GET /buildings/:id/space`，由後端回傳 `SpaceModel` 契約，並在伺服器端完成角色過濾與 AUTO 幾何。

## 前置

- 必读：`docs/16-房源模型接口契约.md`
- 必读：`frontend-admin/src/types/space.ts`
- 必读：`frontend-admin/src/utils/__fixtures__/spaceModel.fixture.ts`
- 基线：`feature/T221-space-platform`
- T221 可并行；`RoomShape` 未合併前先回傳 AUTO 幾何。

## 范围

- 新增 `backend/src/modules/space/`。
- `GET /buildings/:id/space`：
  - ADMIN：全部房間 + 租客／租金。
  - CLEANER：只回傳 `VACANT + PENDING_CLEAN | CLEANING`，不含租客／租金。
  - TENANT：只回傳自己的房間。
  - PUBLIC：另路由只回傳 `VACANT + CLEAN`。
- AUTO 幾何：房號自然排序、每層最多 12 欄、必要時折行。
- `SpaceModel` 契約 v1 回傳。
- 錯誤：401 / 403 / 404。
- 測試：角色矩陣、六態、AUTO 幾何、空樓層、長房號。
- 不改 schema、不改前端。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | ADMIN 取得完整 SpaceModel | service spec |
| 2 | CLEANER 只取得任務房間且無租客/租金 | service spec + authorization e2e |
| 3 | TENANT 只取得自己房間 | service spec |
| 4 | PUBLIC 只取得可出租房間 | service spec |
| 5 | AUTO 每層最多 12 欄、房號自然排序 | service spec |
| 6 | 六態映射與契約一致 | service spec |
| 7 | `npm run build` / `npm test` 通過 | 本地/CI |

## 文件归属

可修改：

- `backend/src/modules/space/*`
- `backend/src/modules/space/**/*.spec.ts`
- 必要时 `backend/test/authorization.e2e-spec.ts` 只加自己的测试段（先与 QA 协调）

禁止修改：

- `backend/prisma/schema.prisma` / migrations
- `backend/src/modules/floor-plans/*`
- `frontend-admin/**`
- `backend/src/app.module.ts`（整合者注册）
- `backend/openapi.json`
- `package.json` / lock

## 开发信息

- 分支：`feature/T222-space-api`
- 工作树：`../租客管理系統-worktrees/T222-space-api`
- 基线：`feature/T221-space-platform`
- 开始时间：2026-10-21
- 状态：in_progress
