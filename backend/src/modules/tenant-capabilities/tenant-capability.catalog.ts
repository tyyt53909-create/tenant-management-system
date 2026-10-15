export interface TenantCapabilityDefinition {
  code: string;
  name: string;
  description: string;
  group: 'contract' | 'bill' | 'prepay' | 'maintenance' | 'checkout';
  defaultEffect: 'ALLOW';
}

/**
 * 租客能力唯一注册清单（事实来源：計劃.md §3）
 * 仅包含可屏蔽的租客级能力，不包含不可屏蔽的底层能力（通知、登录等）
 */
export const TENANT_CAPABILITIES: readonly TenantCapabilityDefinition[] = [
  {
    code: 'tenant.contract.read',
    name: '查看自己的合同',
    description: '查看个人合同列表、详情及附件合同文件',
    group: 'contract',
    defaultEffect: 'ALLOW',
  },
  {
    code: 'tenant.bill.read',
    name: '查看自己的账单与收据',
    description: '查看个人账单列表、账单详情及电子收款收据',
    group: 'bill',
    defaultEffect: 'ALLOW',
  },
  {
    code: 'tenant.prepay.read',
    name: '查看自己的预付账户与流水',
    description: '查看预付钱包账户余额及交易明细流水',
    group: 'prepay',
    defaultEffect: 'ALLOW',
  },
  {
    code: 'tenant.maintenance.read',
    name: '查看自己的报修',
    description: '查看个人报修工单列表及工单处理进度',
    group: 'maintenance',
    defaultEffect: 'ALLOW',
  },
  {
    code: 'tenant.maintenance.create',
    name: '提交报修',
    description: '在线发起新的房屋维修上报工单',
    group: 'maintenance',
    defaultEffect: 'ALLOW',
  },
  {
    code: 'tenant.checkout.read',
    name: '查看自己的退租结算',
    description: '查看个人退租结算清单及退租结算单据',
    group: 'checkout',
    defaultEffect: 'ALLOW',
  },
] as const;

export const TENANT_CAPABILITY_CODES = TENANT_CAPABILITIES.map((c) => c.code) as readonly string[];
export type TenantCapabilityCode = (typeof TENANT_CAPABILITY_CODES)[number];

export function isValidCapabilityCode(code: string): code is TenantCapabilityCode {
  return TENANT_CAPABILITY_CODES.includes(code);
}
