# 项目状态跟踪

> 分支: `feature/T317-tenant-claim`
> 集成基準: `origin/develop` @ `071f08a`
> 發布就緒: **NO-GO**
> Gates: 12 pass / 0 fail / 2 not-run

### NO-GO 原因
  - 安全掃描: not-run
  - 人工 UAT: not-run

---

## 發布 Gate

| Gate | 狀態 | 證據 |
|---|---|---|
| 後端 lint | ✅ pass | 沿用 develop 证据，本提交未重跑全量 lint |
| 後端型別檢查 | ✅ pass | exit 0 |
| 後端單元測試 | ✅ pass | 本提交只重跑认证相关 94 项 |
| 後端 e2e | ✅ pass | 沿用 develop 证据 |
| 管理後台 lint | ✅ pass | 沿用 develop 证据 |
| 管理後台單元測試 | ✅ pass | 沿用 develop 证据 |
| 管理後台 build | ✅ pass | 沿用 develop 证据 |
| 小程序單元測試 | ✅ pass | 沿用 develop 证据 |
| 小程序 build | ✅ pass | 沿用 develop 证据 |
| OpenAPI 生成物 | ✅ pass | 沿用 develop 证据 |
| 文檔檢查 | ✅ pass | 沿用 develop 证据 |
| 整合測試 | ✅ pass | claim-invite + journeys 6 passed |
| 安全掃描 | ⏸ not-run | 尚无 CI artifact |
| 人工 UAT | ⏸ not-run | 尚无验收纪录 |

---

## 任務狀態

| 狀態 | 數量 |
|---|---|
| 已驗證完成 | 40 |
| 歷史完成（缺 merge 證據） | 76 |
| 已完成但未合併 | 0 |
| 已完成但缺 handoff | 0 |
| handoff 未登記 INDEX | 0 |
| 已完成但缺 merge 證據（strict） | 0 |
| 進行中 | 3 |
| 文件 active（不計入進行中） | 12 |
| 草稿 | 6 |
| 阻塞 | 0 |
| 無法分類 | 2 |

### 進行中
- **T315 修复基准与问题清单（R00 / QLT-05）**（active，plan QLT-05，`feature/T315-repair-baseline`）
- **T316 整合测试环境保护（R01 / QLT-05）**（active，plan QLT-05，`feature/T316-int-harness-guard`）
- **T317 租客身份认领（R02 / SEC-04）**（active，plan SEC-04，`feature/T317-tenant-claim`）

### 阻擋發布
- 無

### 資料品質警告
- **T144 保洁小程序**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T145 修复小程序构建工具链**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T146 主题系统迁移至 Vue 3（reactive）**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T147 MVP 端到端验收脚本**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T148 安全收口**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T149 管理后台保洁状态视图**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T164 栖居主题设计迁移**：無法解析 status
- **T165 前端后台栖居主题迁移**：無法解析 status
- **T165 主题工作树后续：后台运行修复**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T166 批量抄表与录入工作台**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T167 财务与业务数据 CSV 导出**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T168 电子收款收据与退租结算凭单**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T169 Google 统一认证与第三方登录**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T170 邮箱验证码登录与邀请码延迟绑定**：文件 status=active，但缺 execution_status/start_time；不計入進行中

---

## 階段

| 階段 | 任務數 | 已完成 | 已驗證 | 未完成 | 其他 |
|---|---:|---:|---:|---:|---:|
| 階段 0 | 6 | 1 | 0 | 5 | 0 |
| 階段 1 | 17 | 17 | 0 | 0 | 0 |
| 階段 2 | 10 | 9 | 0 | 1 | 0 |
| 階段 5 | 10 | 10 | 1 | 0 | 0 |
| 優化計畫 | 33 | 33 | 0 | 0 | 0 |
| 未分類 | 63 | 46 | 39 | 3 | 14 |

---

## 近期交接

- [交接记录：T288 依赖注入清理与大服务拆分（QLT-02）](docs/handoff/2026-10-25-T288-依赖注入与大服务拆分.md)
- [交接记录：T287 小程序工程化（FE-02）](docs/handoff/2026-10-25-T287-小程序工程化.md)
- [交接记录：T286 角色路由与组件拆分（FE-01）](docs/handoff/2026-10-25-T286-角色路由与组件拆分.md)
- [交接记录：T285 前端请求层一致性（COM-05）](docs/handoff/2026-10-25-T285-前端请求层一致性.md)
- [交接记录：T284 公告与定向消息（COM-04）](docs/handoff/2026-10-25-T284-公告与定向消息.md)
- [交接记录：T283 报修工单时间线（COM-03）](docs/handoff/2026-10-25-T283-报修时间线.md)
- [交接记录：T282 实时推送（COM-02）](docs/handoff/2026-10-25-T282-实时推送.md)
- [交接记录：T281 性能基准与 SLO（OPS-09）](docs/handoff/2026-10-25-T281-SLO与性能基准.md)

---

## 統計

- 資料模型：**41** 張表
- OpenAPI 路由：**177** 條
- 後端程式碼：**23845** 行
- 管理後台程式碼：**31512** 行
- 小程序程式碼：**6842** 行
- 文件：**174** 份

### 測試
- 後端單元：本提交只重跑认证相关 94 项
- 後端 e2e：沿用 develop 证据
- 管理後台單元：沿用 develop 证据
- 小程序單元：沿用 develop 证据

---

## 快速連結

- [項目主指南 (README.md)](./README.md)
- [AGENTS 協作總規則 (AGENTS.md)](./AGENTS.md)
- [架構設計與優化計畫 (docs/13-架构与现有代码优化计划.md)](./docs/13-架构与现有代码优化计划.md)
- [文檔唯一索引 (docs/INDEX.md)](./docs/INDEX.md)
- [數據模型設計 (docs/02-数据模型.md)](./docs/02-数据模型.md)
- [接口規範 (docs/05-接口规范.md)](./docs/05-接口规范.md)
- [部署與運維 (docs/12-部署与运维.md)](./docs/12-部署与运维.md)

---

_由 `scripts/collect-gates.mjs` + `scripts/generate-status.mjs` 生成；請勿手改。Legacy 門檻：T230。_
