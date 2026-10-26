# 项目状态跟踪

> 分支: `develop`
> 集成基準: `origin/develop` @ `46b906b`
> 發布就緒: **NO-GO**
> Gates: 12 pass / 0 fail / 2 not-run

### NO-GO 原因
  - 安全掃描: not-run
  - 人工 UAT: not-run

---

## 門禁矩陣

| Gate | 狀態 | 證據 |
|---|---|---|
| 後端 lint | ✅ pass | 196 warnings / 0 errors |
| 後端型別檢查 | ✅ pass | exit 0 |
| 後端單元測試 | ✅ pass | 156 files / 1506 tests |
| 後端 e2e | ✅ pass | 4 files / 69 tests |
| 管理後台 lint | ✅ pass | 0 warnings / 0 errors |
| 管理後台單元測試 | ✅ pass | 22 files / 112 tests |
| 管理後台 build | ✅ pass | exit 0 |
| 小程序單元測試 | ✅ pass | 144 tests |
| 小程序 build | ✅ pass | exit 0 |
| OpenAPI 生成物 | ✅ pass | exit 0 |
| 文檔檢查 | ✅ pass | exit 0 |
| 整合測試 | ✅ pass | 27 files / 86 tests |
| 安全掃描 | ⏸ not-run | 尚無 CI artifact |
| 人工 UAT | ⏸ not-run | 尚無驗收紀錄 |

---

## 任務統計

| 類別 | 數量 |
|---|---|
| 總任務數 | 154 |
| 已驗證完成 | 60 |
| 歷史完成（缺 merge 證據） | 76 |
| 已完成但未合併 | 0 |
| 已完成但缺 handoff | 0 |
| handoff 未登記 INDEX | 0 |
| 已完成但缺 merge 證據（strict） | 0 |
| 進行中 | 0 |
| 文件 active（不計入進行中） | 12 |
| 草稿 | 6 |
| 阻塞 | 0 |
| 無法分類 | 2 |

### 進行中
- 無

### 阻擋發布
- 無

### 資料品質警告
- **T144 保洁小程序**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T145 修复小程序构建工具链**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T146 主题系统迁移至 Vue 3（reactive）**：文件 status=active，但缺 execution_status/start_time；不計入進行中
- **T147 MVP 端到端验收脚本**：文件 status=active，但缺 execution_status/start_time；不计入進行中
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

## 階段進度

| 階段 | 總數 | 完成 | 進行中 | 待開始 | 阻塞 |
|---|---|---|---|---|---|
| 階段 1 | 25 | 25 | 0 | 0 | 0 |
| 階段 2 | 10 | 9 | 0 | 1 | 0 |
| 階段 5 | 10 | 10 | 1 | 0 | 0 |
| 優化計畫 | 33 | 33 | 0 | 0 | 0 |
| 未分類 | 76 | 64 | 56 | 0 | 12 |

---

## 近期交接

- [交接记录：T296 预付线上充值、自动扣费与低余额提醒（PAY-04）](docs/handoff/2026-10-26-T296-预付线上充值与自动扣费.md)
- [交接记录：T297 租客自助中心与服务全景闭环（LSE-05）](docs/handoff/2026-10-26-T297-租客自助中心.md)
- [交接记录：T315–T323 生产化第二轮修复批次（R00–R09）](docs/handoff/2026-10-25-T315-T323-生产化第二轮修复批次.md)
- [交接记录：T295 收款收据、PDF 导出、防伪验真与作废闭环（PAY-03）](docs/handoff/2026-10-25-T295-收款收据与防伪验真.md)
- [交接记录：T294 微信退款、对账与差异处理（PAY-02）](docs/handoff/2026-10-25-T294-微信退款与日终对账.md)
- [交接记录：T293 微信支付 JSAPI 收款（PAY-01）](docs/handoff/2026-10-25-T293-微信支付JSAPI收款.md)
- [交接记录：T292 短信通道与短信 OTP（WX-03）](docs/handoff/2026-10-25-T292-短信通道与短信OTP.md)
- [交接记录：T291 微信订阅消息通道与额度管理（WX-02）](docs/handoff/2026-10-25-T291-微信订阅消息通道与额度管理.md)
- [交接记录：T290 微信登录与身份绑定（WX-01）](docs/handoff/2026-10-25-T290-微信登录与身份绑定.md)
- [交接记录：T289 共享套件（QLT-04）](docs/handoff/2026-10-25-T289-三端共享套件.md)

---

## 統計

- 資料模型：**49** 張表
- OpenAPI 路由：**235** 條
- 後端程式碼：**30570** 行
- 管理後台程式碼：**33170** 行
- 小程序程式碼：**8486** 行
- 文件：**184** 份

### 測試
- 後端單元：156 files / 1506 tests
- 後端 e2e：4 files / 69 tests
- 管理後台單元：22 files / 112 tests
- 小程序單元：144 tests

---

## 快速連結

- [項目主指南 (README.md)](./README.md)
- [AGENTS 協作總規則 (AGENTS.md)](./AGENTS.md)
- [架構設計與優化計畫 (docs/13-架构与现有代码优化计划.md)](./docs/13-架构与现有代码优化计划.md)
- [文檔唯一索引 (docs/INDEX.md)](./docs/INDEX.md)
- [數據模型設計 (docs/02-数据模型.md)](./docs/02-数据模型.md)
- [接口規範 (docs/05-接口规范.md)](./docs/05-接口规范.md)
- [部署與運維 (docs/12-部署与运维.md)](./docs/12-部署与运维.md)
