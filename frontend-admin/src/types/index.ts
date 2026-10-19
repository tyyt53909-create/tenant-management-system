import type { components } from './api.generated';

type ApiSchemas = components['schemas'];

/** 登录请求体，来自 OpenAPI 的 LoginDto。 */
export type LoginForm = ApiSchemas['LoginDto'];

/** 注册请求体，来自 OpenAPI 的 RegisterDto。 */
export type RegisterForm = ApiSchemas['RegisterDto'];

// 用户类型。这是页面使用的形状，不是请求 DTO。
export interface User {
  id: string;
  email: string;
  phone?: string;
  role: 'ADMIN' | 'TENANT';
  createdAt: string;
  features?: {
    meterSimulator?: boolean;
  };
}

/** 房态（与后端 RoomStatus 枚举一致） */
export type RoomStatus = 'VACANT' | 'OCCUPIED' | 'MAINTENANCE' | 'RESERVED';

/** 清洁状态（与后端 CleanStatus 枚举一致） */
export type CleanStatus = 'CLEAN' | 'PENDING_CLEAN' | 'CLEANING';

// 房源
export interface Room {
  id: string;
  buildingId: string;
  roomNumber: string;
  floor: number;
  roomType: 'SINGLE' | 'ONE_BED' | 'TWO_BED' | 'THREE_BED' | 'STUDIO';
  area: number;
  facilities: string[];
  status: RoomStatus;
  cleanStatus: CleanStatus;
  /** 乐观锁版本号（房态流转/编辑时回传） */
  version: number;
  /** 列表接口附带楼栋信息（GET /rooms 返回值） */
  building?: { id: string; name: string };
  contracts?: {id:string;contractNumber:string;status:string;rentAmount:number;startDate:string;endDate:string;tenant?:{name:string};bills?:{dueDate:string}[]}[];
  createdAt: string;
  updatedAt: string;
}

// 租客
export interface Tenant {
  id: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  idNumber: string;
  /** 列表和详情只给脱敏值，明文走单独的查看接口。 */
  idNumberMasked?: string | null;
  emergencyContact?: string;
  emergencyPhone?: string;
  isActive?:boolean;
  contracts?:{id:string;contractNumber:string;startDate:string;endDate:string;status:string;rentAmount:number;room?:{roomNumber:string}}[];
  prepayAccounts?:{balanceCache:number}[];
  /** 标签（T215）：字典中的 { id, name } */
  tags?: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
  /** 派生：与表格显示一致的时间串，供排序用 */
  createdAtSort?: string;
}

// 楼栋
export interface Building {
  id: string;
  name: string;
  address: string;
  totalFloors: number;
  metadata?: any;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// 合同
export interface Contract {
  id: string;
  contractNumber: string;
  buildingId: string;
  roomId: string;
  tenantId: string;
  room?: { id: string; roomNumber: string; building?: { name:string } };
  tenant?: { id: string; name: string; phone?:string };
  startDate: string;
  endDate: string;
  rentAmount: number;
  depositAmount: number;
  paymentCycle: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
  paymentDay: number;
  /** RENEWED 表示本合同已被新合同替代（见后端 ContractStatus） */
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED' | 'RENEWED';
  /** 续签来源：本合同的上一份合同 id（T154）；为空表示非续签生成 */
  renewedFromId?: string | null;
  /** 本合同的续签结果（后端 renewedTo 反向关系） */
  renewedTo?: { id: string; contractNumber: string } | null;
  /** 派生：仅日期部分，供表头排序用（与显示值一致） */
  startDateOnly?: string;
  endDateOnly?: string;
  createdAt: string;
  updatedAt: string;
}

// 账单
export interface Bill {
  id: string;
  contractId: string;
  contract?: { contractNumber?:string; room?:{roomNumber:string}; tenant?:{name:string} };
  billNumber: string;
  billType: 'RENT' | 'UTILITY' | 'OTHER';
  period: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  /**
   * 列表接口随行返回的滞纳金摘要（T157）。
   * 用于避免对当前页每行再发一次 GET /bills/:id/late-fees（原 N+1）。
   * 打开滞纳金弹窗时仍会拉取完整明细。
   */
  lateFeeSummary?: LateFeeSummary;
  /** 派生：仅日期部分，供表头排序用（与显示值一致） */
  dueDateOnly?: string;
  createdAt: string;
  updatedAt: string;
}

/** 滞纳金摘要（列表展示用，金额单位：分） */
export interface LateFeeSummary {
  count: number;
  status: 'none' | 'suggested' | 'confirmed' | 'settled';
  /** 已确认合计；未确认时为 null（此时只展示 suggestedAmount） */
  amount: number | null;
  suggestedAmount: number;
  settledAmount: number;
  pendingSettled: number;
  overdueDays: number;
}

/** 滞纳金计算规则快照（合同 lateFeeRule 归一化，金额单位：分） */
export interface LateFeeRuleSnapshot {
  /** 宽限天数（逾期前 N 天不计收） */
  graceDays: number;
  /** 按日比例（与 fixedDaily 二选一，优先本项） */
  dailyRate: number | null;
  /** 固定金额（分/天） */
  fixedDaily: number | null;
  /** 封顶金额（分），null 表示不封顶 */
  cap: number | null;
}

/** 滞纳金计算过程（后端 LateFee.calculation，管理者可见） */
export interface LateFeeCalculation {
  rule: LateFeeRuleSnapshot;
  /** 逾期天数（自然日，到期日当天不计） */
  overdueDays: number;
  /** 计费天数（逾期天数 − 宽限天数，最小 0） */
  effectiveDays: number;
  /** 计费基数（未缴金额，分） */
  baseAmount: number;
  /** 封顶前金额（分） */
  rawAmount: number;
  /** 是否触发封顶 */
  capped: boolean;
}

/**
 * 滞纳金记录（GET / POST /bills/:id/late-fees）
 *
 * 语义（T140/T141）：
 * - `confirmedAmount === null`：仅有系统建议值，**尚未入账**，仅供参考；
 * - `confirmedAmount` 写入：管理者确认入账（可为 0，表示减免）；
 * - `settledAmount`：收款核销时累加，`settledAmount >= confirmedAmount` 视为已核销。
 */
export interface LateFee {
  id: string;
  billId: string;
  /** 系统建议值（分，不自动入账） */
  suggestedAmount: number;
  /** 管理者确认金额（分）；null = 尚未确认 */
  confirmedAmount: number | null;
  /** 逾期天数（自然日） */
  overdueDays: number;
  calculation: LateFeeCalculation | null;
  notes: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** 已核销金额（分，部分核销累加） */
  settledAmount: number | null;
  settledAt: string | null;
  settledBy: string | null;
  createdAt: string;
}

// 报修
export interface Maintenance {
  id: string;
  photos?: { id:string;fileUrl:string }[];
  _count?: { photos:number };
  room?: { roomNumber:string };
  tenant?: { name:string };
  roomId: string;
  tenantId: string;
  title: string;
  description: string;
  category: 'PLUMBING' | 'ELECTRICAL' | 'APPLIANCE' | 'FURNITURE' | 'DOOR_WINDOW' | 'OTHER';
  priority: 'LOW' | 'NORMAL' | 'URGENT';
  status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'ASSIGNED' | 'IN_PROGRESS' | 'PENDING_CONFIRM' | 'COMPLETED' | 'CANCELLED';
  assignedTo?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

/** 审计日志（后台写操作自动记录，由 AuditLogInterceptor 产生） */
export interface AuditLog {
  id: string;
  userId: string;
  /** 形如 "POST /api/rooms" */
  action: string;
  entityType: string;
  /** 路径参数 id；列表类操作为 "-" */
  entityId: string;
  /** 请求体/参数/查询快照 */
  changes: Record<string, unknown> | null;
  ip: string;
  userAgent: string;
  createdAt: string;
  /** 操作者（后端 include 带出） */
  user?: { id: string; email: string | null; role: string } | null;
}

/** 通知优先级（与后端 NotificationPriority 枚举一致，docs/09 待确认清单 §12：两级） */
export type NotificationPriority = 'NORMAL' | 'URGENT';

/** 通知（GET /notifications；服务端已按当前登录用户硬过滤 userId） */
export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  /** NORMAL=普通，URGENT=紧急 */
  priority: NotificationPriority;
  isRead: boolean;
  readAt: string | null;
  /** 附加业务数据（后端 data，Json? 字段） */
  data?: Record<string, any> | null;
  createdAt: string;
  /** 过期时间（保留 180 天相关字段，后端返回 Json 原值） */
  expiredAt?: string | null;
}

// 水电表
export interface Meter {
  id: string;
  room?: { roomNumber:string };
  buildingId: string;
  roomId?: string;
  meterType: 'ELECTRICITY' | 'WATER' | 'GAS';
  meterNumber: string;
  unitPrice: number;
  priceEffectiveDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// 退租结算项类别（与后端 CheckoutItemType 枚举一一对应）
export type CheckoutItemType =
  | 'RENT_REFUND' // 租金退还
  | 'DEPOSIT_REFUND' // 押金退还
  | 'DEPOSIT_DEDUCTION' // 押金扣除
  | 'UTILITY_REFUND' // 水电余额退还
  | 'OTHER_FEE' // 其他费用
  | 'OTHER_REFUND'; // 其他退款

// 退租结算明细项（接口返回结构，amount 单位为分）
export interface CheckoutItem {
  id?: string;
  checkoutId?: string;
  itemType: CheckoutItemType;
  description: string;
  /** 金额，单位：分 */
  amount: number;
  calculation?: unknown;
  isAdjusted?: boolean;
  adjustReason?: string;
  createdAt?: string;
}

// 退租结算明细项（提交体，不含服务端生成字段；amount 单位为分）
export interface CheckoutItemPayload {
  itemType: CheckoutItemType;
  description: string;
  /** 金额，单位：分 */
  amount: number;
  calculation?: unknown;
  isAdjusted?: boolean;
  adjustReason?: string;
}

// 退租记录
export interface CheckoutRecord {
  id: string;
  contractId: string;
  roomId: string;
  checkoutDate: string;
  /** 退款金额，单位：分 */
  totalRefund: number;
  status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
  processedBy: string;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /** 结算明细：列表接口不返回，详情接口（GET /checkout/:id）返回 */
  items?: CheckoutItem[];
}

// 新增/编辑退租记录提交体（金额单位均为分）
export interface CheckoutPayload {
  contractId: string;
  roomId: string;
  checkoutDate: string;
  /** 退款金额，单位：分 */
  totalRefund: number;
  processedBy: string;
  notes?: string;
  status?: CheckoutRecord['status'];
  /** 结算明细：一旦提供，后端要求至少 1 项，且每项必须有类别/说明/非负整数金额（分） */
  items?: CheckoutItemPayload[];
}

// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// 查询参数
export interface QueryParams {
  page?: number;
  limit?: number;
  [key: string]: any;
}

// 邀请码
export interface InviteCode {
  id: string;
  code: string;
  role: 'ADMIN' | 'TENANT';
  status: 'UNUSED' | 'USED' | 'REVOKED';
  notes?: string | null;
  creatorId?: string | null;
  creator?: { id: string; email: string; phone?: string | null };
  usedById?: string | null;
  usedBy?: { id: string; email: string; phone?: string | null };
  usedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
