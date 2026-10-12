---
status: completed
task_id: T134
stage: 阶段1 补强（主流程打通）
priority: P0
model_tier: 普通
estimated_hours: 3
actual_hours: 2.5
branch: feature/T134-id-validation
worktree: /Users/Admin/ai/租客管理系統-worktrees/T134-id-validation
start_time: 2026-10-12
complete_time: 2026-10-12
pr: pending
---

# T134: 修复 DTO 校验问题（主流程打通）

## 背景

T133 烟测发现「通过 API 创建房源必然失败」。本任务全面扫描同类问题，共发现三组缺陷，全部阻塞主流程：

1. **rooms 楼栋 ID 误用 UUID 校验**：`buildingId` 校验 `@IsUUID('4')`，但实际 ID 为 `building-001`（seed）或 Prisma cuid，永远不通过（创建 + 筛选查询均失效）
2. **DTO 枚举与数据库枚举不一致**：
   - `contracts` PaymentCycle：DTO `SEMI_ANNUALLY/ANNUALLY` vs 数据库 `SEMI_ANNUAL/ANNUAL`（半年付/年付合同必 500 或无法提交）
   - `checkout` CheckoutStatus：DTO `PROCESSING` vs 数据库 `PENDING`
   - `maintenance` MaintenanceStatus：DTO `RESOLVED/CLOSED` vs 数据库 7 值集合（双方互斥，正常状态流转不可用）
3. **无装饰器的 JSON 字段触发 forbidNonWhitelisted**：`contracts.lateFeeRule`、`bills.snapshot` 缺校验装饰器，在 `target: ES2023`（class fields define 语义）下实例自带到 DTO，被全局 ValidationPipe 拒绝（**不带该字段的请求也 400**）

---

## 任务范围

### 后端修复

1. `rooms` create/query DTO：`buildingId` 改为 `@IsString()`（与其余模块一致）
2. `contracts` PaymentCycle 对齐数据库：`MONTHLY / QUARTERLY / SEMI_ANNUAL / ANNUAL`
3. `checkout` CheckoutStatus 对齐数据库：`DRAFT / PENDING / COMPLETED / CANCELLED`
4. `maintenance` MaintenanceStatus 对齐数据库 7 值：`SUBMITTED / ACKNOWLEDGED / ASSIGNED / IN_PROGRESS / PENDING_CONFIRM / COMPLETED / CANCELLED`
5. `contracts.lateFeeRule`、`bills.snapshot` 补 `@IsOptional()`
6. 扫描确认：其余模块（bills/meters/prepay/checkout/tenants 等）外键字段均已用 `@IsString()`，无同类问题；Response DTO 无装饰器属纯输出类型，不受影响

### 前端与小程序同步

7. 前端：`types/index.ts`、contracts / checkout / maintenance 页面的选项值、中文标签、徽章映射
8. 小程序：contract 支付周期映射、maintenance 状态映射、首页「待处理报修」过滤条件（COMPLETED/CANCELLED）

### 回归测试

9. 新增 5 个 DTO 校验 spec（rooms / contracts / checkout / maintenance / bills），**复刻全局 ValidationPipe 配置**（whitelist + forbidNonWhitelisted），确保同类问题以后测得出

---

## 验收标准

1. ✅ 后端 `tsc --noEmit` 通过；vitest **18 文件 102 用例全绿**
2. ✅ 前端 `vue-tsc` + `vite build` 通过
3. ✅ **端到端主流程全部经 API 走通**（此前不可能）：
   - 建房源（building-001）→ 楼栋筛选查询 → 建租客 → 建合同（半年付）→ 激活合同 → 建账单 → 报修 5 段状态流转 → 退租单 + PENDING
   - 仪表板实时反映：totalRooms/activeContracts/pendingBills 全部吻合
   - 清理后归零

---

## 交付物

- `backend/src/modules/*/dto/*.ts`（8 个 DTO 修复 + 5 个回归 spec）
- `frontend-admin/src/{types/index.ts, views/contracts, views/checkout, views/maintenance}`
- `miniprogram/pages/{contract, maintenance, index}`

---

## 备注

- 全局 ValidationPipe 保持 `forbidNonWhitelisted: true` 不变（安全严格性是好事，修复方向是补齐装饰器）
- 本任务只修校验层；`bills.paidAmount` 直改数字、无收款流水登记的问题仍存在（下一任务）
