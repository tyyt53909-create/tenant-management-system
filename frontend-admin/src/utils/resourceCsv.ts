import { formatDateOnly,formatDateTime } from './table';
import { centsToYuan } from './money';
import { stateLabel } from './resource';
import { unpaidOf } from './billRow';
import { PAYMENT_CYCLES,ROOM_TYPES } from './propertyDetail';
import type { ResourceRecord } from './resource';
import type { CsvColumn } from './csv';
export type ExportResource='rooms'|'tenants'|'contracts'|'bills'|'maintenance'|'prepay'|'meters'|'checkout'|'notifications'|'cleaning';
const column=(label:string,value:(row:ResourceRecord)=>unknown):CsvColumn<ResourceRecord>=>({label,value});
const amount=(value:unknown)=>value==null?null:centsToYuan(value);
export function csvColumns(kind:ExportResource):CsvColumn<ResourceRecord>[] {
  const columns:Record<ExportResource,CsvColumn<ResourceRecord>[]>={
    rooms:[column('房间号',r=>r.roomNumber),column('楼栋',r=>r.building?.name),column('楼层',r=>r.floor),column('房型',r=>ROOM_TYPES[r.roomType]),column('面积(m²)',r=>r.area),column('房态',r=>stateLabel(r.status)),column('清洁状态',r=>stateLabel(r.cleanStatus))],
    cleaning:[column('房间号',r=>r.roomNumber),column('楼栋',r=>r.building?.name),column('清洁状态',r=>stateLabel(r.cleanStatus)),column('最近更新',r=>formatDateTime(r.updatedAt))],
    tenants:[column('姓名',r=>r.name),column('手机号',r=>r.phone),column('邮箱',r=>r.email),column('紧急联系人',r=>r.emergencyContact),column('紧急联系电话',r=>r.emergencyPhone)],
    contracts:[column('合同编号',r=>r.contractNumber),column('租客',r=>r.tenant?.name),column('房源',r=>r.room?.roomNumber),column('开始日期',r=>formatDateOnly(r.startDate)),column('到期日期',r=>formatDateOnly(r.endDate)),column('租金(元)',r=>amount(r.rentAmount)),column('押金(元)',r=>amount(r.depositAmount)),column('付款周期',r=>PAYMENT_CYCLES[r.paymentCycle]),column('合同状态',r=>stateLabel(r.status))],
    bills:[column('账单编号',r=>r.billNumber),column('租客',r=>r.contract?.tenant?.name),column('房源',r=>r.contract?.room?.roomNumber),column('账期',r=>r.period),column('应收(元)',r=>amount(r.amount)),column('已收(元)',r=>amount(r.paidAmount)),column('账单未收(元)',r=>amount(unpaidOf({ amount: r.amount ?? 0, paidAmount: r.paidAmount ?? 0, status: r.status }))),column('到期日',r=>formatDateOnly(r.dueDate)),column('账单状态',r=>stateLabel(r.status))],
    maintenance:[column('工单标题',r=>r.title),column('描述',r=>r.description),column('房源',r=>r.room?.roomNumber),column('租客',r=>r.tenant?.name),column('优先级',r=>({LOW:'低',NORMAL:'普通',URGENT:'紧急'} as Record<string,string>)[r.priority]),column('状态',r=>stateLabel(r.status)),column('提交时间',r=>formatDateTime(r.createdAt))],
    prepay:[column('租客',r=>r.tenant?.name),column('房源',r=>r.roomNumber),column('余额(元)',r=>amount(r.balanceCache)),column('预警阈值(元)',r=>amount(r.lowBalanceThreshold)),column('最近更新',r=>formatDateTime(r.updatedAt))],
    meters:[column('表号',r=>r.meterNumber),column('房源',r=>r.room?.roomNumber),column('类型',r=>({WATER:'水表',ELECTRICITY:'电表',GAS:'燃气表'} as Record<string,string>)[r.meterType]),column('单价(元)',r=>amount(r.unitPrice)),column('价格生效日',r=>formatDateOnly(r.priceEffectiveDate)),column('状态',r=>r.isActive?'启用':'停用')],
    checkout:[column('合同编号',r=>r.contract?.contractNumber),column('租客',r=>r.contract?.tenant?.name),column('房源',r=>r.room?.roomNumber),column('退租日',r=>formatDateOnly(r.checkoutDate)),column('结算净额(元)',r=>amount(r.totalRefund)),column('状态',r=>stateLabel(r.status)),column('备注',r=>r.notes)],
    notifications:[column('标题',r=>r.title),column('正文',r=>r.body),column('状态',r=>r.isRead?'已读':'未读'),column('时间',r=>formatDateTime(r.createdAt))],
  };
  return columns[kind];
}
