import { formatMoney, formatDateOnly, formatDateTime } from './table';
export type ResourceKind = 'rooms' | 'tenants' | 'contracts' | 'bills' | 'maintenance' | 'meters' | 'checkout' | 'buildings';
export type ResourceRecord = Record<string, any>;
const states: Record<string, string> = { VACANT:'空置', OCCUPIED:'已出租', RESERVED:'已预订', MAINTENANCE:'维护中', CLEAN:'已清洁', CLEANING:'清洁中', PENDING_CLEAN:'待清洁', DRAFT:'草稿', ACTIVE:'生效中', EXPIRED:'已过期', TERMINATED:'已终止', RENEWED:'已续签', PENDING:'待缴付', PARTIAL:'部分缴纳', PAID:'已缴清', OVERDUE:'已逾期', CANCELLED:'已取消', SUBMITTED:'已提交', ACKNOWLEDGED:'已受理', ASSIGNED:'已派单', IN_PROGRESS:'处理中', PENDING_CONFIRM:'待确认', COMPLETED:'已完成' };
export function stateLabel(value: string) { return states[value] || value || '—'; }
export function recordLabel(kind: string, row: ResourceRecord) {
  if (kind === 'rooms') return `${row.building?.name || '房源'} · ${row.roomNumber || '未命名'}`;
  if (kind === 'tenants') return `${row.name || '租客'}${row.phone ? ` · ${row.phone}` : ''}`;
  if (kind === 'contracts') return `${row.contractNumber || '合同'} · ${row.room?.roomNumber || '房源未关联'} · ${row.tenant?.name || '租客未关联'}`;
  return row.name || row.title || row.billNumber || row.meterNumber || '详情';
}
export function detailSections(kind: ResourceKind, row: ResourceRecord) {
  const text = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);
  const type: Record<string,string> = { SINGLE:'单间', ONE_BED:'一室一厅', TWO_BED:'两室一厅', THREE_BED:'三室一厅', STUDIO:'开间', MONTHLY:'月付', QUARTERLY:'季付', SEMI_ANNUAL:'半年付', ANNUAL:'年付', RENT:'租金', UTILITY:'水电费', OTHER:'其他', PLUMBING:'水管问题', ELECTRICAL:'电路问题', APPLIANCE:'家电维修', FURNITURE:'家具维修', DOOR_WINDOW:'门窗维修', LOW:'低', NORMAL:'普通', URGENT:'紧急' };
  const section = (title: string, fields: [string, unknown][]) => ({ title, fields: fields.map(([label,value]) => ({ label, value:text(value) })) });
  const place = row.room || row.contract?.room;
  const tenant = row.tenant || row.contract?.tenant;
  const business = {
    rooms: [section('房源信息', [['楼栋',row.building?.name],['房间号',row.roomNumber],['楼层',row.floor == null ? null : `${row.floor} 楼`],['房型',type[row.roomType]],['面积',row.area == null ? null : `${row.area} m²`],['房态',stateLabel(row.status)],['清洁状态',stateLabel(row.cleanStatus)]]),section('居住设施', [['配备设施',Array.isArray(row.facilities) && row.facilities.length ? row.facilities.join('、') : '尚未记录'],['备注',row.description]])],
    tenants: [section('联系方式', [['姓名',row.name],['手机号',row.phone],['邮箱',row.email],['证件号',row.idNumberMasked || '未登记']]),section('紧急联系人', [['联系人',row.emergencyContact],['联系电话',row.emergencyPhone]]),section('标签', [['标签',Array.isArray(row.tags) && row.tags.length ? row.tags.map((tag: { name: string }) => tag.name).join('、') : '尚未打标签']])],
    contracts: [section('签约信息', [['房源',place?.roomNumber],['租客',tenant?.name],['合同编号',row.contractNumber],['状态',stateLabel(row.status)]]),section('合同约定', [['开始日期',formatDateOnly(row.startDate)],['结束日期',formatDateOnly(row.endDate)],['租金',formatMoney(row.rentAmount)],['押金',formatMoney(row.depositAmount)],['付款周期',type[row.paymentCycle]],['缴付日',row.paymentDay ? `每月 ${row.paymentDay} 日` : null]])],
    bills: [section('账单信息', [['房源',place?.roomNumber],['租客',tenant?.name],['账单编号',row.billNumber],['费用类型',type[row.billType]],['账期',row.period],['缴付日期',formatDateOnly(row.dueDate)],['状态',stateLabel(row.status)]]),section('收款情况', [['账单金额',formatMoney(row.amount)],['已收金额',formatMoney(row.paidAmount)],['账单未收',formatMoney(Math.max(0,(row.amount || 0)-(row.paidAmount || 0)))],['说明','滞纳金另行核对；实际收款请查看收款流水。']])],
    maintenance: [section('报修信息', [['房源',place?.roomNumber],['租客',tenant?.name],['问题类别',type[row.category]],['紧急程度',type[row.priority]],['当前状态',stateLabel(row.status)]]),section('问题与处理', [['问题描述',row.description],['处理说明',row.resolution || '尚未记录处理结果']])],
    meters: [section('水电表', [['表号',row.meterNumber],['房源',place?.roomNumber || '公共区域'],['单价',formatMoney(row.unitPrice)],['价格生效',formatDateOnly(row.priceEffectiveDate)],['状态',row.isActive ? '启用' : '停用']])],
    checkout: [section('退租信息', [['房源',place?.roomNumber],['合同',row.contract?.contractNumber],['退租日期',formatDateOnly(row.checkoutDate)],['状态',stateLabel(row.status)],['退款金额',formatMoney(row.totalRefund)],['备注',row.notes]])],
    buildings: [section('楼栋信息', [['名称',row.name],['地址',row.address],['总楼层',row.totalFloors],['状态',row.isActive ? '启用' : '停用']])],
  };
  return [...business[kind], section('记录信息', [['创建时间',formatDateTime(row.createdAt)],['最近更新',formatDateTime(row.updatedAt)]])];
}
export function protectedFilePath(value: string) {
  if (typeof value !== 'string') return null;
  const path = value.startsWith('/api/') ? value.slice(4) : value;
  const allowed = /^\/files\/[A-Za-z0-9._%/-]+$/.test(path) || /^\/contracts\/[A-Za-z0-9_-]+\/attachments\/[A-Za-z0-9_-]+\/file$/.test(path);
  return allowed && !path.includes('..') ? path : null;
}
