# 项目状态跟踪

> 分支: `docs/T250-m0-closeout`
> 集成基準: `origin/develop` @ `53df199`
> 發布就緒: **NO-GO**
> Gates: 11 pass / 0 fail / 3 not-run

### NO-GO 原因
  - 整合測試: not-run
  - 安全掃描: not-run
  - 人工 UAT: not-run
  - T230: unmerged

---

## 發布 Gate

| Gate | 狀態 | 證據 |
|---|---|---|
| 後端 lint | ✅ pass | exit 0 |
| 後端型別檢查 | ✅ pass | exit 0 |
| 後端單元測試 | ✅ pass | 90 files / 911 tests |
| 後端 e2e | ✅ pass | 2 files / 58 tests |
| 管理後台 lint | ✅ pass | exit 0 |
| 管理後台單元測試 | ✅ pass | 17 files / 79 tests |
| 管理後台 build | ✅ pass | exit 0 |
| 小程序單元測試 | ✅ pass | 112 tests |
| 小程序 build | ✅ pass | exit 0 |
| OpenAPI 生成物 | ✅ pass | exit 0 |
| 文檔檢查 | ✅ pass | exit 0 |
| 整合測試 | ⏸ not-run | T231 尚未提供可執行套件 |
| 安全掃描 | ⏸ not-run | 尚無 CI artifact |
| 人工 UAT | ⏸ not-run | 尚無驗收紀錄 |

---

## 任務狀態

| 狀態 | 數量 |
|---|---|
| 已驗證完成 | 0 |
| 歷史完成（缺 merge 證據） | 76 |
| 已完成但未合併 | 1 |
| 已完成但缺 handoff | 0 |
| handoff 未登記 INDEX | 0 |
| 已完成但缺 merge 證據（strict） | 0 |
| 進行中 | 1 |
| 文件 active（不計入進行中） | 12 |
| 草稿 | 7 |
| 阻塞 | 0 |
| 無法分類 | 2 |

### 進行中
- **T250 M0 生产化收口**（active，plan M0，`docs/T250-m0-closeout`）

### 阻擋發布
- **T230 房源照片上传**：completed，但 feature/T230-room-photos 尚未合併進 origin/develop

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
| 階段 5 | 10 | 10 | 0 | 0 | 0 |
| 優化計畫 | 33 | 33 | 0 | 0 | 0 |
| 未分類 | 23 | 7 | 0 | 2 | 14 |

---

## 近期交接

- [交接记录：T250 M0 生产化收口](docs/handoff/2026-10-23-T250-M0生产化收口.md)
- [交接记录：T230 房源照片上传](docs/handoff/2026-10-21-T230-房源照片上传.md)
- [交接记录：T228 房源模型视觉重做](docs/handoff/2026-10-21-T228-房源模型视觉重做.md)
- [交接记录：T225～T227 房源模型 Wave 2](docs/handoff/2026-10-21-T225-T227-房源模型Wave2.md)
- [交接记录：T221～T224 房源模型 Wave 1](docs/handoff/2026-10-21-T221-T224-房源模型Wave1.md)
- [交接记录：T220-房源模型系统（Phase 1）](docs/handoff/2026-10-21-T220-房源模型系统.md)
- [交接记录：T218-水电对账](docs/handoff/2026-10-18-T218-水电对账.md)
- [交接记录：T217-公共水电分摊](docs/handoff/2026-10-18-T217-公共水电分摊.md)

---

## 統計

- 資料模型：**34** 張表
- OpenAPI 路由：**140** 條
- 後端程式碼：**17369** 行
- 管理後台程式碼：**27686** 行
- 小程序程式碼：**6631** 行
- 文件：**122** 份

### 測試
- 後端單元：90 files / 911 tests
- 後端 e2e：2 files / 58 tests
- 管理後台單元：17 files / 79 tests
- 小程序單元：112 tests

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
