import type { ResourceKind,ResourceRecord } from './resource';
export function resourceDetailTabs(kind:ResourceKind){
  if(kind==='tenants')return [{id:'overview',label:'基本资料'},{id:'contracts',label:'租赁关联'},{id:'audit',label:'操作记录'}];
  if(kind==='bills')return [{id:'overview',label:'费用明细'},{id:'payments',label:'收款进度'},{id:'audit',label:'操作记录'}];
  if(kind==='maintenance')return [{id:'progress',label:'工单进度'},{id:'overview',label:'报修详情'},{id:'audit',label:'操作记录'}];
  if(kind==='meters')return [{id:'overview',label:'设备资料'},{id:'readings',label:'读数历史'}];
  return [{id:'overview',label:'基本资料'},{id:'audit',label:'操作记录'}];
}
export const MAINTENANCE_STEPS=[{value:'SUBMITTED',label:'提交'},{value:'ACKNOWLEDGED',label:'受理'},{value:'ASSIGNED',label:'派单'},{value:'IN_PROGRESS',label:'维修'},{value:'PENDING_CONFIRM',label:'待确认'},{value:'COMPLETED',label:'完成'}];
export function maintenanceStep(status:string){return MAINTENANCE_STEPS.findIndex(step=>step.value===status);}
/** 只展示已经记录的时间，不用阶段位置编造操作日志。 */
export function maintenanceEvents(record:ResourceRecord){return [{label:'工单提交',time:record.createdAt},{label:'人员指派',time:record.assignedAt},{label:'维修处理记录',time:record.resolvedAt}].filter(event=>!!event.time);}
export function billProgress(record:ResourceRecord){const amount=Number(record.amount);const paid=Number(record.paidAmount);return Number.isFinite(amount)&&amount>0&&Number.isFinite(paid)?Math.min(100,Math.max(0,Math.round(paid/amount*100))):0;}
