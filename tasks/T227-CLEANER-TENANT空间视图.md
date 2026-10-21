---
status: in_progress
task_id: T227
stage: 第五阶段（房源空间可视化 / Wave 2）
priority: P1
model_tier: 强
branch: feature/T227-space-roles-mini
start_time: 2026-10-21
complete_time: null
handoff: null
---

# T227: CLEANER / TENANT 空间视图（小程序）

## 背景

T222 的 Space API 已支援 CLEANER / TENANT 投影。T227 把空间视图下放到小程序：

- CLEANER：只看待清潔／清潔中房間，依樓層分佈，快速接單/完成。
- TENANT：只看自己的房間，不暴露其他房間佔用。

## 前置

- 必读：`docs/16-房源模型接口契约.md`
- 必读：`miniprogram/pages/cleaning/cleaning.vue`
- 必读：`miniprogram/pages/index/index.vue`
- 基线：`feature/T221-space-platform` @ `2adfdfd`

## 范围

- CLEANER：
  - 保洁工作台加入 2D 楼层任务图（可用现有 `getCleaningRooms` 数据，不必强制调 Space API）。
  - 任务图只显示待清洁/清洁中房间。
  - 点击房间滚动/聚焦对应任务卡，保留原有接单/完成操作。
- TENANT：
  - 首页「我的居所」加入小范围 2D 位置图，只高亮自己的房间。
  - 若无法取得 buildingId，先用现有合同/房间信息显示楼层/房号，不伪造整栋模型。
  - 不显示其他房间的入住状态。
- 可新增 `miniprogram/components/SpaceMiniMap.vue`、`miniprogram/api/space.js`。
- 不改后端、不改管理后台、不改 package.json。

## 验收

| # | 标准 | 验证 |
|---|---|---|
| 1 | CLEANER 只看到任务房间 | unit/manual |
| 2 | CLEANER 接单/完成仍可用 | existing tests + manual |
| 3 | TENANT 只看到自己房间 | unit/manual |
| 4 | 不泄露其他房间/租客/租金 | code review + fixture |
| 5 | `npm test`（miniprogram）通过 | 本地/CI |
| 6 | 不修改 admin/backend | git diff 检查 |

## 文件归属

可修改／新增：

- `miniprogram/pages/cleaning/cleaning.vue`
- `miniprogram/pages/index/index.vue`
- `miniprogram/components/SpaceMiniMap.vue`（新增）
- `miniprogram/api/space.js`（新增，如需）
- `miniprogram/api/cleaning.js` / `contracts.js`（只在必要时小幅扩展）

禁止修改：

- `backend/**`
- `frontend-admin/**`
- `miniprogram/package.json` / lock
- 其他任务文件

## 开发信息

- 分支：`feature/T227-space-roles-mini`
- 工作树：`/Users/Admin/ai/tenant-system-worktrees/T227-space-roles-mini`
- 基线：`feature/T221-space-platform` @ `2adfdfd`
- 开始时间：2026-10-21
- 状态：in_progress
