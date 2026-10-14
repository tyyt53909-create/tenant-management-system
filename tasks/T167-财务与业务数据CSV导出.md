---
status: active
owner_tier: strong
applies_to:
  - backend/src/common/utils/csv.util.ts
  - backend/src/modules/bills/**
  - backend/src/modules/meters/**
  - backend/src/modules/prepay/**
  - backend/src/modules/checkout/**
  - frontend-admin/src/utils/export.ts
last_verified: 2026-10-14
verified_commit: 5158949
supersedes: null
superseded_by: null
version: 1.0
---

# T167: 财务与业务数据 CSV 导出

## 1. 任务背景
公寓管理系统中的账单台账、抄表记录、预付流水和退租结算记录需要定期交由财务人员进行对账和审计归档。此前系统仅支持在页面分页浏览，缺少通用的批量导出通道。

## 2. 目标与范围
- **通义 CSV 生成工具库**：
  - `backend/src/common/utils/csv.util.ts`：实现 `generateCsv`，带 UTF-8 BOM（`\uFEFF`），解决 Windows/macOS Excel 打开中文乱码问题；单元格含逗号、引号、换行时安全转义。
- **四大核心模块导出接口**：
  - `GET /bills/export`：账单编号、房号、租客名、手机、账期、各分项金额、滞纳金、到期日、状态。
  - `GET /meters/export`：房间、楼栋、表计类型、上次/当前读数、用量、抄表日期、抄表员、自动生成账单编号。
  - `GET /prepay-accounts/transactions/export`：账户、租客、房号、流水类型、金额、操作后余额、说明、交易时间。
  - `GET /checkout-records/export`：合同ID、房号、租客、退租日期、退款金额、状态、经办人、备注。
- **前端通用导出组件与页面打通**：
  - `frontend-admin/src/utils/export.ts`：封装基于 Blob 的安全流下载。
  - 账单管理、抄表管理、预付账户（含单账户流水导出）、退租结算列表页面无缝挂载导出按钮。

## 3. 验收标准
- [x] 工具函数单元测试覆盖特殊字符（逗号、双引号、换行、数字防截断）与 UTF-8 BOM。
- [x] 后端 4 大模块导出接口全部通过单元测试与路由校验。
- [x] 前端 4 大模块管理页面导出按钮联动当前查询筛选条件。
- [x] 成功量化：导出的 CSV 文件直接用 Excel 双击打开无乱码，数据 100% 匹配。
