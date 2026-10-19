import { PaymentCycle, RoomType } from '@prisma/client';

/** 一个可导入实体需要的列定义与校验（T216） */
export interface ColumnDef {
  name: string;
  required?: boolean;
  /** 示例值，写进模板 */
  sample: string;
}

export interface ImportEntity {
  key: 'tenants' | 'contracts' | 'bills';
  label: string;
  columns: ColumnDef[];
  /** 文件内用于判重的列 */
  uniqueKey: string;
}

export const IMPORT_ENTITIES: Record<ImportEntity['key'], ImportEntity> = {
  tenants: {
    key: 'tenants',
    label: '租客',
    uniqueKey: 'phone',
    columns: [
      { name: 'name', required: true, sample: '张三' },
      { name: 'phone', required: true, sample: '13800138000' },
      { name: 'email', sample: 'zhangsan@example.com' },
      { name: 'emergencyContact', sample: '李四' },
      { name: 'emergencyPhone', sample: '13900139000' },
      { name: 'notes', sample: '' },
    ],
  },
  contracts: {
    key: 'contracts',
    label: '合同',
    uniqueKey: 'contractNumber',
    columns: [
      { name: 'contractNumber', required: true, sample: 'HT-2026-001' },
      { name: 'tenantPhone', required: true, sample: '13800138000' },
      { name: 'roomNumber', required: true, sample: '101' },
      { name: 'floor', sample: '1' },
      { name: 'rentAmount', required: true, sample: '1800.00' },
      { name: 'depositAmount', required: true, sample: '1800.00' },
      { name: 'paymentCycle', required: true, sample: 'MONTHLY' },
      { name: 'paymentDay', required: true, sample: '5' },
      { name: 'startDate', required: true, sample: '2026-01-01' },
      { name: 'endDate', required: true, sample: '2026-12-31' },
      { name: 'status', sample: 'ACTIVE' },
    ],
  },
  bills: {
    key: 'bills',
    label: '账单',
    uniqueKey: 'contractNumber+period+billType',
    columns: [
      { name: 'contractNumber', required: true, sample: 'HT-2026-001' },
      { name: 'billType', required: true, sample: 'RENT' },
      { name: 'period', required: true, sample: '2026-01' },
      { name: 'amount', required: true, sample: '1800.00' },
      { name: 'paidAmount', sample: '0.00' },
      { name: 'dueDate', required: true, sample: '2026-01-05' },
      { name: 'status', sample: 'PENDING' },
    ],
  },
};

export const PAYMENT_CYCLES: PaymentCycle[] = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL'];
export const ROOM_TYPES: RoomType[] = ['SINGLE', 'ONE_BED', 'TWO_BED', 'THREE_BED', 'STUDIO'];
