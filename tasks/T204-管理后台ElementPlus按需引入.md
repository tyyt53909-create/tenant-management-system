---
status: completed
task_id: T204
stage: 优化计划收口（OPT-19#3 首屏 JS）
priority: P1
model_tier: 强
estimated_hours: 4
branch: feature/T204-admin-ondemand
start_time: 2026-10-17
complete_time: 2026-10-17
depends_on: T203
handoff: docs/handoff/2026-10-17-T204-管理后台ElementPlus按需引入.md
---

# T204: 管理后台 Element Plus 按需引入（OPT-19#3）

分支自 `feature/T203-tech-debt-closure`（T202 → T203 → T204 依次叠加）。

## 目标

让 OPT-19「首屏 JS 比优化前下降 ≥ 30%」真正达标。T203 已实测确认：只做元件拆分（T192）并没有降低首屏体积，因为 `main.ts` 仍 `app.use(ElementPlus)` 全量注册；T204 改为按需引入并复测。

## 验收标准

- [x] 首屏 JS 相比优化前下降 ≥ 30%（实测 −88%）。
- [x] `npm run build`（含 `vue-tsc`）、`npm run lint`、`npm test` 全绿。
- [x] 逐路由冒烟：无「Failed to resolve component/directive」告警，Element Plus 元件正常渲染。
- [x] 中文 locale 不回退（分页文案仍为中文）。
- [x] 不改变业务行为与既有主题样式加载顺序。
- [x] 交接记录 `docs/handoff/2026-10-17-T204-管理后台ElementPlus按需引入.md` 并在 `docs/INDEX.md` 注册。

## 开发信息

- 分支: feature/T204-admin-ondemand
- 状态: completed（本地分支，**未推送、未合并**）
