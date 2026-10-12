// 用户类型
export interface User {
  id: string;
  email: string;
  phone?: string;
  role: 'ADMIN' | 'TENANT';
  createdAt: string;
}

// 登录表单
export interface LoginForm {
  account: string; // email 或 phone
  password: string;
}

// 注册表单
export interface RegisterForm {
  email: string;
  phone: string;
  password: string;
  name: string;
  inviteCode: string;
}

// 房源
export interface Room {
  id: string;
  buildingId: string;
  roomNumber: string;
  floor: number;
  roomType: 'SINGLE' | 'ONE_BED' | 'TWO_BED' | 'THREE_BED' | 'STUDIO';
  area: number;
  facilities: string[];
  monthlyRent: number;
  deposit: number;
  status: 'VACANT' | 'OCCUPIED' | 'MAINTENANCE' | 'RESERVED';
  cleanStatus: 'CLEAN' | 'NEEDS_CLEANING' | 'IN_CLEANING';
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
  emergencyContact?: string;
  emergencyPhone?: string;
  createdAt: string;
  updatedAt: string;
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
  startDate: string;
  endDate: string;
  rentAmount: number;
  depositAmount: number;
  paymentCycle: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
  paymentDay: number;
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  createdAt: string;
  updatedAt: string;
}

// 账单
export interface Bill {
  id: string;
  contractId: string;
  billNumber: string;
  billType: 'RENT' | 'UTILITY' | 'OTHER';
  period: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

// 报修
export interface Maintenance {
  id: string;
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

// 水电表
export interface Meter {
  id: string;
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

// 退租记录
export interface CheckoutRecord {
  id: string;
  contractId: string;
  roomId: string;
  checkoutDate: string;
  totalRefund: number;
  status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'CANCELLED';
  notes?: string;
  processedBy: string;
  createdAt: string;
  updatedAt: string;
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
