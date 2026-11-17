# 项目状态跟踪

> 分支: `fix/T337-deployment-regressions`
> 集成基準: `origin/develop` @ `0f7acf4`
> 發布就緒: **NO-GO**
> Gates: 12 pass / 0 fail / 2 not-run

### NO-GO 原因
  - 安全掃描: not-run
  - 人工 UAT: not-run

---

## 發布 Gate

| Gate | 狀態 | 證據 |
|---|---|---|
| 後端 lint | ✅ pass | 232 warnings / 0 errors |
| 後端型別檢查 | ✅ pass | exit 0 |
| 後端單元測試 | ✅ pass | 174 files / 1719 tests |
| 後端 e2e | ✅ pass | 4 files / 83 tests |
| 管理後台 lint | ✅ pass | 0 warnings / 0 errors |
| 管理後台單元測試 | ✅ pass | 22 files / 112 tests |
| 管理後台 build | ✅ pass | exit 0 |
| 小程序單元測試 | ✅ pass | 168 tests |
| 小程序 build | ✅ pass | exit 0 |
| OpenAPI 生成物 | ✅ pass | exit 0 |
| 文檔檢查 | ✅ pass | exit 0 |
| 整合測試 | ✅ pass | 34 files / 113 tests |
| 安全掃描 | ⏸ not-run | 尚無 CI artifact |
| 人工 UAT | ⏸ not-run | 尚無驗收紀錄 |

---

## 任務狀態

| 狀態 | 數量 |
|---|---|
| 已驗證完成 | 64 |
| 歷史完成（缺 merge 證據） | 76 |
| 已完成但未合併 | 0 |
| 已完成但缺 handoff | 0 |
| handoff 未登記 INDEX | 0 |
| 已完成但缺 merge 證據（strict） | 0 |
| 進行中 | 6 |
| 文件 active（不計入進行中） | 12 |
| 草稿 | 6 |
| 阻塞 | 0 |
| 無法分類 | 2 |

### 進行中
- **T304 保洁任务：自动建单、指派、验收（WRK-03）**（active，plan WRK-03，`feature/T304-cleaning-tasks`）
- **T324 读数结算标记防伪**（active，plan FIN-08，`fix/T324-meter-marker-guard`）
- **T325 ｜CORE-01 账单并发写入**（active，plan FIN-05，`fix/T325-bill-write-lock`）
- **T326 ｜CORE-02 表计并发与结算游标**（active，plan FIN-08，`fix/T326-meter-settlement-lock`）
- **T337 ｜发布链路 P1 修复**（active，plan M3，`fix/T337-deployment-regressions`）
- **T338 ｜共享源码 CI 路径过滤**（active，plan QLT-04，`fix/T338-shared-ci-paths`）

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
| 未分類 | 90 | 70 | 63 | 6 | 14 |

---

## 近期交接

- [交接记录：T337 发布链路 P1 修复](docs/handoff/2026-11-18-T337-发布链路P1修复.md)
- [交接记录：T304 保洁任务：自动建单、指派、验收（WRK-03）](docs/handoff/2026-10-28-T304-保洁任务自动建单指派与验收.md)
- [交接记录：T303 维修工单：派工、SLA、员工端、费用转嫁（WRK-02）](docs/handoff/2026-10-26-T303-维修工单派工SLA与费用转嫁.md)
- [交接记录：T302 员工角色、权限与楼栋范围（WRK-01）](docs/handoff/2026-10-26-T302-员工角色权限与楼栋范围.md)
- [交接记录：T301 到期提醒、续约意向与续约报价（LSE-04）](docs/handoff/2026-10-26-T301-到期提醒续约意向与续约报价.md)
- [交接记录：T300 入住/退租验房与租客退租申请（LSE-03）](docs/handoff/2026-10-26-T300-入住退租验房与退租申请.md)
- [交接记录：T299 合同模板、PDF、电子签约与共同承租人（LSE-02）](docs/handoff/2026-10-26-T299-合同模板PDF电子签约共同承租人.md)
- [交接记录：T298 招租挂牌、意向线索、看房预约与分享卡片（LSE-01）](docs/handoff/2026-10-26-T298-招租挂牌线索看房预约.md)

---

## 統計

- 資料模型：**56** 張表
- OpenAPI 路由：**280** 條
- 後端程式碼：**37349** 行
- 管理後台程式碼：**36888** 行
- 小程序程式碼：**8721** 行
- 文件：**192** 份

### 測試
- 後端單元：174 files / 1719 tests
- 後端 e2e：4 files / 83 tests
- 管理後台單元：22 files / 112 tests
- 小程序單元：168 tests

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
