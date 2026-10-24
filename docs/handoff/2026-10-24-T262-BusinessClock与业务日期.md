---
status: active
owner_tier: strong
applies_to:
  - backend/src/common/business-clock/**
  - backend/src/modules/statistics/**
  - backend/src/modules/dashboard/**
  - backend/src/modules/meters/**
  - backend/src/modules/bills/**
  - backend/src/modules/checkout/**
  - backend/src/modules/prepay/**
last_verified: 2026-10-24
verified_commit: 349e5ce
supersedes: null
superseded_by: null
version: 1.0
---

# 交接记录：T262 BusinessClock 与业务日期

---
日期: 2026-10-24
任务: T262-FIN-09-BusinessClock与业务日期
对话ID: session-t262
模型: DeepSeek V4.1 Flash
状态: completed（PR #72 已合并，merge commit `349e5ce`；分支按约定保留）
---

## 完成内容

### BusinessClock
- ✅ 新增 `common/business-clock` 纯函数核心 + 全局 `BusinessClock` service + `BusinessClockModule`。
- ✅ 业务日统一为 `Asia/Shanghai` → UTC 零点；月/季/年范围使用 UTC 边界。
- ✅ `parseDateOnly` 严格解析 `yyyy-MM-dd`，拒绝 `2026-02-30` 等溢出。
- ✅ `BUSINESS_TIMEZONE` 可配，非法 IANA 时区启动失败。

### 替换范围
- ✅ `scheduler.util` 改为委托纯函数，保留既有导出。
- ✅ 统计（月/季/年/自定义）、仪表板月份桶、V3 摘要的今日/本月。
- ✅ 水电用量月份键、结算补缴账单到期日。
- ✅ 账单/预付/退租/抄表导出文件名与收据日期。
- ✅ 导入日期解析。
- ⚠️ 合同号/水电账单号移除 `Math.random()`；**普通账单号当时漏改**（2026-10-24 T264 审查发现，已在 T264 补修）。
- ✅ `grep` 业务模块已无 `getFullYear()/getMonth()/getDate()/setDate(` 直接运算。

### 测试
- ✅ 后端 107 文件 / 1036 用例通过。
- ✅ `TZ=UTC` 与 `TZ=Asia/Shanghai` 下 clock 单测、e2e 均通过。
- ✅ 两个 TZ 下 `e2e-mvp` 均 27/27。
- ✅ lint / tsc / docs-check / env-check 通过。

## 遗留问题

1. **历史 @db.Date 数据**
   - 优先级：低
   - 说明：本任务只统一计算口径；如历史数据曾按 UTC 写入但业务日应为上海日，需专项核对。
2. **业务时区可配置**
   - 优先级：低
   - 说明：当前单组织固定 `Asia/Shanghai`；改成其他时区前需评估存量账单日。
3. **前端展示时区**
   - 优先级：中
   - 说明：后端返回 `yyyy-MM-dd` 字符串；前端不得再用本地 `new Date()` 二次换算，留待 FE-01。

## 下一步

- ✅ 已创建 PR #72 并合并（merge commit `349e5ce`）。
- ✅ 已回填 `merge_commit`、任务书/handoff 置 completed，并重新生成 STATUS。
- 下一个无阻塞 M1 任务：T251（OPS-08 CI 闸门与 staging）→ T255（QLT-01 真实数据库测试骨架）；T263 依赖 QLT-01。

## 附加信息

### 提交记录
- 分支：`feature/T262-fin-09`
- 基线：`2ac3ef6`（`origin/develop`，含 T261 回填）
- PR：#72（已合并，merge commit `349e5ce`）

### 资源
- 任务书：`tasks/T262-FIN-09-BusinessClock与业务日期.md`
- 验收证据：`tasks/evidence/T262.md`
- 核心：`backend/src/common/business-clock/`

---

**交接给**: T263（FIN-01）负责模型
**确认人**: @human-owner

---

## 更正（2026-10-24，T264 审查）

- 上文「账单号改用 `randomHex(3)`」只覆盖合同号与水电账单号；**普通账单号（`bills.service.ts create`）仍为 `Math.random()`**，属漏改。
- 已在 T264 分支补修：普通账单号改用 `randomHex(3)`，并补单测；导出日期/创建时间统一走 `formatBusinessDate` / `formatBusinessDateTime`。
- 详见 `tasks/evidence/T264.md` 第 6 节。
