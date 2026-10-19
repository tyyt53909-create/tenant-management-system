---
status: completed
task_id: T205
stage: 优化计划收口（OPT-19#3 收尾：组件类型声明）
priority: P2
model_tier: 强
estimated_hours: 3
branch: feature/T205-admin-slot-typing
start_time: 2026-10-17
complete_time: 2026-10-17
depends_on: T204
handoff: docs/handoff/2026-10-17-T205-管理后台插槽类型标注与dts启用.md
---

# T205: 管理后台插槽行类型收窄与组件 dts 启用

分支自 `feature/T204-admin-ondemand`（T202 → T203 → T204 → T205 依次叠加）。

## 目标

收掉 T204 的临时取舍：把 `unplugin-vue-components` 的 `dts` 重新打开，让 `vue-tsc` 对
`<el-*>` 组件与 `v-loading` 指令做真实类型检查；同时把因此暴露的 11 个视图、79 处
表格插槽 `row`（`DefaultRow`）错误清零。

## 验收标准

- [x] `vite.config.ts` 恢复 dts 生成（`dts: 'src/components.d.ts'`），生成文件纳入版本管理。
- [x] 79 处 TS2345/TS2322 全部消除（78 处调用点收窄 + 1 处 `typeBadgeMap` 值类型）。
- [x] `npm run build`（含 `vue-tsc`）、`npm run lint`、`npm test`（12 档 49 例）全绿。
- [x] 运行时冒烟：打桩 API 逐路由加载 16/16 无「Failed to resolve component/directive」告警，
      并额外验证 7 条交互（含批量抄表弹窗内表格行）无告警、无 pageerror。
- [x] 只改类型标注，未改业务逻辑、模板结构与样式（`element-plus/dist/index.css`）链路。
- [x] 交接记录 `docs/handoff/2026-10-17-T205-管理后台插槽类型标注与dts启用.md` 并在 `docs/INDEX.md` 注册。

## 关键结论（与原设想不同，需记录）

任务书原定写法是插槽标注 `<template #default="{ row }: { row: Room }">`。实测在本仓库
tsconfig 下**不成立**：slot 函数参数受 `strictFunctionTypes` 逆变约束，收窄即报
「`(_: { row: Room; }) => any` is not assignable to `(props: { row: DefaultRow; ... }) => any`」。
替代方案与实测结果见交接记录 §四，最终采用**调用点收窄**（`f(row as Room)`），类型收益等价、
不放宽任何编译配置。

## 开发信息

- 分支: feature/T205-admin-slot-typing
- 状态: completed（本地分支，**未推送、未合并**）
