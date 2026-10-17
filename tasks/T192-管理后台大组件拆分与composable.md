---
status: completed
task_id: T192
stage: 优化计划 M3 / OPT-19
priority: P2
model_tier: 强
estimated_hours: 16
branch: feature/T192-admin-composables
start_time: 2026-10-16 23:20:00
complete_time: 2026-10-16 23:45:00
handoff: docs/handoff/2026-10-16-T192-管理后台大组件拆分与composable.md
---

# T192: 管理后台大组件拆分与 composable 抽象（OPT-19）

依据优化计划 OPT-19。分支从 `feature/T191-cleanup-and-invite-codes` 拉出。

## 目标

1. **抽象通用 Composables**：
   - 提取 `usePagedTable`：统一封装列表请求、分页参数、加载状态、重置与关键词查询逻辑。
   - 提取 `useDialogForm`：统一封装表单弹窗开关、提交加载、重置验证逻辑。
   - 提取 `useMoney`：封装金额（分/元）转换、格式化与校验。
2. **拆分超大页面与组件（全仓 .vue 文件限制 <= 500 行）**：
   - 拆分 `bills/index.vue`（1054 行 -> 466 行）-> 列表视图 + 独立收据/收款弹窗子组件。
   - 拆分 `checkout/index.vue`（795 行 -> 377 行）-> 列表视图 + 退租结算弹窗子组件。
   - 拆分 `VoucherRecognitionModal.vue`（752 行 -> 428 行）-> 弹窗骨架 + 识别结果核对表单子组件。
   - 拆分 `UtilitiesOverviewCard.vue`（737 行 -> 440 行）-> 看板卡片 + 图表展示/详情子组件。
   - 拆分 `meters/index.vue`（604 行 -> 397 行）-> 列表视图 + 抄表操作/子弹窗。
   - 拆分 `TenantAccountCapabilities.vue`（552 行 -> 444 行）-> 能力矩阵控制台 + 能力项覆写子组件。
   - 优化 `rooms/index.vue`（504 行 -> 456 行）-> 抽离房态流转弹窗至 <= 500 行。
3. **列表页复用与体积极致优化**：
   - 至少 5 个核心列表页接入 `usePagedTable`（buildings, settings/InviteCodes, bills, checkout, meters）。
   - 确保 ECharts 按需引入与构建产物优化。
4. **质量门禁与全绿保证**：
   - `vue-tsc -b && vite build` 打包成功，无类型错误。
   - 前端测试全部通过，后端与小程序测试不受影响。

## 验收标准

- [x] 没有超过 500 行的 `.vue` 文件（find frontend-admin/src -name "*.vue" | xargs wc -l 全部 <= 500）
- [x] 至少 5 个列表页共用 `usePagedTable`
- [x] 拆分后页面交互行为不变，前端与后端测试保持全绿
- [x] 构建打包成功
