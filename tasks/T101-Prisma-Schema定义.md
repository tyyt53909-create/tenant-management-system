---
status: draft
task_id: T101
stage: 阶段1
priority: P0
model_tier: 强
estimated_hours: 6
---

# T101: Prisma Schema 定义（P0 核心表）

## 任务信息

- **任务编号**: T101
- **所属阶段**: 阶段1 - 核心地基与样板模块
- **优先级**: P0（阻塞所有业务开发）
- **建议模型档位**: 强
- **预计工时**: 6小时
- **前置依赖**: T004（数据库初始化）
- **阻塞任务**: T102-T126（所有后续任务）

---

## 任务目标

根据数据模型设计文档，定义 Prisma Schema 中的所有 P0 核心表结构（18张表），确保字段类型、索引、外键关系正确。

---

## 任务范围

### 必须完成

**P0 表（18张，第一版必须实现）**：
1. Building（楼栋）
2. Room（房间）
3. PublicArea（公共区域）
4. Tenant（租客）
5. User（用户账号）
6. Contract（合同）
7. ContractAttachment（合同附件）
8. Bill（账单）
9. PaymentRecord（收款记录）
10. LateFee（滞纳金）
11. PrepayAccount（预付账户）
12. PrepayTransaction（预付流水）
13. Meter（水电表）
14. MeterReading（读数记录）
15. MaintenanceRequest（报修工单）
16. MaintenancePhoto（报修照片）
17. CheckoutRecord（退租记录）
18. CheckoutItem（退租明细）

**P1 表（2张，尽量实现）**：
19. Notification（通知）
20. AuditLog（审计日志）

**预留表（4张，仅建表结构）**：
21. TenantRegistration（租客登记）
22. DeviceToken（设备令牌）
23. RoomPhoto（房源照片）
24. MeterPriceHistory（单价历史）

### 不包括
- 数据初始化（T102）
- 迁移执行（T103）

---

## 涉及文件

### 修改文件
```
backend/prisma/schema.prisma
```

---

## 详细实现步骤

### 步骤1：删除测试表，准备 Schema

编辑 `backend/prisma/schema.prisma`，删除 SystemInfo 测试表，保留基础配置：

```prisma
// This is your Prisma schema file
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// 核心表定义开始
// ============================================
```

### 步骤2：定义枚举类型

```prisma
// ============================================
// 枚举定义
// ============================================

// 房间类型
enum RoomType {
  SINGLE      // 单间
  ONE_BED     // 一室
  TWO_BED     // 两室
  THREE_BED   // 三室
  STUDIO      // 开间
}

// 房间状态
enum RoomStatus {
  VACANT          // 空置
  RESERVED        // 预订（已签合同未入住）
  OCCUPIED        // 已租
  MAINTENANCE     // 维修中
}

// 清洁状态
enum CleanStatus {
  CLEAN           // 已清洁（可出租）
  PENDING_CLEAN   // 待清洁
  CLEANING        // 清洁中
}

// 公共区域类型
enum PublicAreaType {
  HALLWAY      // 走廊
  STAIRWELL    // 楼梯间
  ELEVATOR     // 电梯
  ROOF         // 天台
  ENTRANCE     // 入口
  OTHER        // 其他
}

// 证件类型
enum IdType {
  ID_CARD       // 身份证
  PASSPORT      // 护照
  OTHER         // 其他
}

// 登记状态
enum RegistrationStatus {
  NOT_REGISTERED    // 未登记
  PENDING           // 待申报
  REGISTERED        // 已登记
  REJECTED          // 被驳回
}

// 付款周期
enum PaymentCycle {
  MONTHLY       // 月付
  QUARTERLY     // 季付
  SEMI_ANNUAL   // 半年付
  ANNUAL        // 年付
}

// 合同状态
enum ContractStatus {
  DRAFT         // 草稿
  ACTIVE        // 生效中
  EXPIRED       // 已到期
  TERMINATED    // 已终止（提前退租）
  RENEWED       // 已续签（被新合同替代）
}

// 附件类型
enum AttachmentType {
  CONTRACT_SCAN   // 合同扫描件
  ID_PHOTO        // 证件照片（第二阶段）
  OTHER           // 其他
}

// 账单类型
enum BillType {
  RENT        // 租金账单
  UTILITY     // 水电费账单（预付账户不足时补缴）
  OTHER       // 其他费用
}

// 账单状态
enum BillStatus {
  PENDING     // 待缴费
  PARTIAL     // 部分缴费
  PAID        // 已缴清
  OVERDUE     // 逾期
  CANCELLED   // 已取消
}

// 付款方式
enum PaymentMethod {
  CASH          // 现金
  BANK_TRANSFER // 银行转账
  WECHAT        // 微信
  ALIPAY        // 支付宝
  OTHER         // 其他
}

// 预付交易类型
enum PrepayTransactionType {
  RECHARGE      // 充值
  DEDUCTION     // 扣费
  REFUND        // 退款
  ADJUSTMENT    // 调整（管理员手动）
}

// 关联类型
enum RelatedType {
  METER_READING      // 关联读数
  CHECKOUT           // 关联退租
  MANUAL_ADJUSTMENT  // 手动调整
}

// 水电表类型
enum MeterType {
  ELECTRICITY   // 电表
  WATER         // 水表
  GAS           // 燃气表（预留）
}

// 读数来源
enum ReadingSource {
  MANUAL    // 手动录入
  DEVICE    // 智能设备（第二阶段）
}

// 报修类别
enum MaintenanceCategory {
  PLUMBING      // 水管
  ELECTRICAL    // 电路
  APPLIANCE     // 电器
  FURNITURE     // 家具
  DOOR_WINDOW   // 门窗
  OTHER         // 其他
}

// 报修优先级
enum MaintenancePriority {
  LOW           // 低
  NORMAL        // 普通
  URGENT        // 紧急
}

// 报修状态
enum MaintenanceStatus {
  SUBMITTED     // 已提交
  ACKNOWLEDGED  // 已受理
  ASSIGNED      // 已派单
  IN_PROGRESS   // 维修中
  PENDING_CONFIRM // 待确认（等租客确认完成）
  COMPLETED     // 已完成
  CANCELLED     // 已取消
}

// 退租状态
enum CheckoutStatus {
  DRAFT       // 草稿（管理者填写结算单）
  PENDING     // 待处理（已提交结算单，等待打款）
  COMPLETED   // 已完成
  CANCELLED   // 已取消
}

// 退租结算项类型
enum CheckoutItemType {
  RENT_REFUND       // 租金退还
  DEPOSIT_REFUND    // 押金退还
  DEPOSIT_DEDUCTION // 押金扣除
  UTILITY_REFUND    // 水电余额退还
  OTHER_FEE         // 其他费用
  OTHER_REFUND      // 其他退款
}

// 租金折算方式
enum RentCalculationMethod {
  ACTUAL_DAYS       // 实际天数 ÷ 当月天数
  FIXED_30_DAYS     // 固定按30天
}

// 用户角色
enum UserRole {
  ADMIN       // 管理者
  CLEANER     // 保洁
  TENANT      // 租客
}

// 通知优先级
enum NotificationPriority {
  NORMAL    // 普通
  URGENT    // 紧急
}

// 设备类型
enum DeviceType {
  ANDROID
  IOS
  WEB
}
```

### 步骤3：定义 P0 核心表（参考数据模型文档）

由于完整的 schema 非常长（约1500行），这里给出关键表的定义，完整版本请参考 `docs/02-数据模型.md`：

```prisma
// ============================================
// P0 核心表（18张）
// ============================================

// 1. Building（楼栋）
model Building {
  id        String   @id @default(cuid())
  name      String   // "XX号楼"
  address   String?  // 详细地址
  floors    Int      // 楼层数
  metadata  Json?    // 扩展信息
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  rooms        Room[]
  publicAreas  PublicArea[]
  contracts    Contract[]
  meters       Meter[]

  @@index([isActive])
  @@map("buildings")
}

// 2. Room（房间）
model Room {
  id          String      @id @default(cuid())
  buildingId  String
  building    Building    @relation(fields: [buildingId], references: [id])
  
  floor       Int
  roomNumber  String
  roomType    RoomType
  area        Decimal?    @db.Decimal(6, 2)
  
  facilities  Json?
  description String?     @db.Text
  
  status      RoomStatus   @default(VACANT)
  cleanStatus CleanStatus  @default(CLEAN)
  
  version     Int         @default(0)  // 乐观锁
  
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  contracts           Contract[]
  meters              Meter[]
  maintenanceRequests MaintenanceRequest[]
  checkoutRecords     CheckoutRecord[]
  photos              RoomPhoto[]

  @@unique([buildingId, floor, roomNumber])
  @@index([buildingId, status])
  @@index([status, cleanStatus])
  @@map("rooms")
}

// 3. PublicArea（公共区域）
model PublicArea {
  id         String         @id @default(cuid())
  buildingId String
  building   Building       @relation(fields: [buildingId], references: [id])
  
  name       String
  areaType   PublicAreaType
  floor      Int?
  
  createdAt  DateTime       @default(now())

  meters Meter[]

  @@index([buildingId])
  @@map("public_areas")
}

// 4. Tenant（租客）
model Tenant {
  id               String    @id @default(cuid())
  name             String
  phone            String    @unique
  email            String?   @unique
  
  emergencyContact String?
  emergencyPhone   String?
  
  tags             Json?
  notes            String?   @db.Text
  
  isActive         Boolean   @default(true)
  
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  user                 User?  @relation(fields: [userId], references: [id])
  userId               String? @unique
  
  contracts            Contract[]
  prepayAccounts       PrepayAccount[]
  maintenanceRequests  MaintenanceRequest[]
  registration         TenantRegistration?

  @@index([isActive])
  @@index([phone])
  @@map("tenants")
}

// 5. User（用户账号）
model User {
  id               String    @id @default(cuid())
  email            String?   @unique
  phone            String?   @unique
  passwordHash     String
  
  role             UserRole
  
  inviteCode       String?   @unique
  inviteExpiredAt  DateTime?
  invitedBy        String?
  
  isActive         Boolean   @default(true)
  lastLoginAt      DateTime?
  
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  tenant       Tenant?
  auditLogs    AuditLog[]
  notifications Notification[]
  deviceTokens  DeviceToken[]

  @@index([email])
  @@index([phone])
  @@index([inviteCode])
  @@index([role, isActive])
  @@map("users")
}

// 6-18. 其他P0表...
// (完整定义见下方完整Schema)
```

**注意**：由于完整的 Schema 太长，我将创建完整版本。让我继续编写完整的 schema.prisma 内容：

### 完整 Schema（续）

```prisma
// 6. Contract（合同）
model Contract {
  id             String         @id @default(cuid())
  buildingId     String
  building       Building       @relation(fields: [buildingId], references: [id])
  roomId         String
  room           Room           @relation(fields: [roomId], references: [id])
  tenantId       String
  tenant         Tenant         @relation(fields: [tenantId], references: [id])
  
  contractNumber String         @unique
  
  rentAmount     Int
  depositAmount  Int
  
  paymentCycle   PaymentCycle
  paymentDay     Int
  
  startDate      DateTime       @db.Date
  endDate        DateTime       @db.Date
  
  lateFeeRule    Json
  
  status         ContractStatus @default(DRAFT)
  
  renewedFromId  String?
  renewedFrom    Contract?      @relation("ContractRenewal", fields: [renewedFromId], references: [id])
  renewedTo      Contract?      @relation("ContractRenewal")
  
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  bills           Bill[]
  attachments     ContractAttachment[]
  checkoutRecords CheckoutRecord[]

  @@index([buildingId, status])
  @@index([tenantId, status])
  @@index([roomId, status])
  @@index([status, endDate])
  @@map("contracts")
}

// 继续其他表定义...
```

由于完整 Schema 太长，我会在实际文件中提供完整版本。

---

## 验收标准

### Schema 验收
1. ✅ 所有 P0 表（18张）定义完整
2. ✅ 所有枚举类型定义正确
3. ✅ 所有外键关系正确
4. ✅ 所有索引按设计文档添加
5. ✅ 所有唯一约束正确
6. ✅ `npx prisma format` 无错误
7. ✅ `npx prisma validate` 通过

### 字段验收
1. ✅ 金额字段使用 Int（以分为单位）
2. ✅ 日期字段使用 @db.Date 或 @db.Timestamp
3. ✅ 大文本字段使用 @db.Text
4. ✅ Decimal 字段指定精度
5. ✅ 所有必需字段无默认值或有合理默认值

### 关系验证
1. ✅ Building → Room 一对多
2. ✅ Room → Contract 一对多
3. ✅ Tenant → Contract 一对多
4. ✅ Contract → Bill 一对多
5. ✅ PrepayAccount → PrepayTransaction 一对多

---

## 禁止改动项

1. ❌ 不得偏离数据模型文档的设计
2. ❌ 不得在此任务中执行迁移（留给 T103）
3. ❌ 不得在此任务中添加测试数据（留给 T102）

---

## 交付物

1. 完整的 `prisma/schema.prisma`（约1500行）
2. Schema 格式化和验证通过
3. 所有表、字段、关系按文档定义

---

## 风险与注意事项

### 风险
1. **Schema 复杂度高**：24张表，需要仔细核对
2. **关系错误**：外键关系错误会导致迁移失败

### 注意事项
1. 严格参考 `docs/02-数据模型.md`
2. 金额统一使用 Int（分为单位）
3. 乐观锁字段 `version` 不要忘记
4. 自关联（如 Contract.renewedFrom）需要注意
5. 每完成一部分就运行 `npx prisma format` 和 `npx prisma validate`

---

## 后续任务

- **T102**: 初始化数据（依赖本任务）
- **T103**: 数据库迁移与验证（依赖本任务）

---

## 参考资料

- [数据模型设计文档](../../docs/02-数据模型.md) - **必读**
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
