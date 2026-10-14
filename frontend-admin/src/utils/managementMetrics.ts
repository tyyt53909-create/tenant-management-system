import { formatMoney } from './table';
export type ManagementKey='rooms'|'tenants'|'contracts'|'bills'|'maintenance'|'cleaning'|'prepay'|'meters'|'checkout'|'notifications';
export type ManagementSnapshot=Record<ManagementKey,Record<string,number>> & {generatedAt:string;ownerId:string};
export interface ManagementMetric {key:string;label:string;note:string;icon:string;money?:boolean;unit?:string;tone?:string}
const metric=(key:string,label:string,note:string,icon:string,unit=''):ManagementMetric=>({key,label,note,icon,unit});
export const MANAGEMENT_METRICS:Record<ManagementKey,ManagementMetric[]>={
  rooms:[metric('total','房源总数','全量在管房源','house','间'),metric('occupied','已出租','当前房态为已出租','users','间'),metric('vacant','空置房源','当前房态为空置','house','间'),metric('maintenance','维护中','等待处理与恢复','tools','间'),metric('reserved','已预订','尚未正式入住','calendar','间')],
  tenants:[metric('total','租客档案','全量档案，保留历史','users','人'),metric('residents','关联生效租约','按租客去重统计','user','人'),metric('drafts','仅关联草稿','暂无生效租约','calendar','人'),metric('unlinked','尚无租约','未关联合同的档案','document','人'),metric('enabled','启用档案','当前 isActive 为启用','check','人')],
  contracts:[metric('total','合同档案','全量合同记录','document','份'),metric('active','生效合同','当前状态为生效中','check','份'),{...metric('expiring','即将到期','生效合同，未来 30 天','clock','份'),tone:'warning'},metric('draft','草稿合同','待核对签约资料','calendar','份'),metric('expired','已过期','当前合同状态已过期','document','份')],
  bills:[metric('total','有效账单','全量统计，不含已取消','document','笔'),{...metric('billed','账单应收','不含另计滞纳金','wallet'),money:true},{...metric('paid','账单已收','已登记的账单收款','check'),money:true,tone:'success'},{...metric('remaining','账单未收','不含另计滞纳金','clock'),money:true,tone:'warning'},{...metric('overdue','逾期账单','需优先核对与跟进','alert','笔'),tone:'danger'}],
  maintenance:[metric('submitted','待受理','新提交的报修工单','alert','项'),metric('following','跟进中','已受理、已派单或维修中','tools','项'),metric('confirm','待确认','等待确认维修结果','clock','项'),metric('completed','已完成','已归档完成的工单','check','项'),{...metric('urgent','紧急未结工单','建议优先响应','alert','项'),tone:'danger'}],
  cleaning:[metric('pending','待清洁','仅统计空置房源','brush','间'),metric('progress','清洁中','仅统计空置房源','tools','间'),metric('ready','已清洁空房','已准备好清洁状态','check','间'),metric('total','空置房源','不是保洁预约任务数','house','间')],
  prepay:[metric('total','预付账户','全量账户记录','users','户'),{...metric('balance','可用余额合计','账户余额缓存合计','wallet'),money:true},metric('low','低于预警阈值','采用每户各自的阈值','alert','户'),{...metric('negative','负余额账户','需要及时核对','alert','户'),tone:'danger'},metric('zero','零余额账户','当前余额为 0','wallet','户')],
  meters:[metric('total','在用设备','启用的水、电、燃气表','meter','块'),metric('read','本月已抄','每台设备只计一次','check','块'),metric('pending','本月未抄','在用设备中尚无本月读数','calendar','块'),metric('water','本月用水','按读数时间汇总用量','meter','吨'),metric('electricity','本月用电','按读数时间汇总用量','chart','度')],
  checkout:[metric('total','退租记录','全部历史与当前记录','checkout','笔'),metric('draft','草稿','等待核对结算资料','document','笔'),metric('pending','待处理','需核对并完成结算','clock','笔'),metric('completed','已完成','已完成的结算记录','check','笔'),{...metric('refund','未完成结算净额','草稿与待处理，不代表已退款','wallet'),money:true}],
  notifications:[metric('total','我的通知','仅当前管理员的通知','bell','条'),metric('unread','未读通知','等待查看与跟进','alert','条'),metric('read','已读通知','保留查阅记录','check','条'),{...metric('urgent','紧急未读','优先处理的重要提醒','alert','条'),tone:'warning'}],
};
export function metricValue(metric:ManagementMetric,values?:Record<string,number>){const value=values?.[metric.key];return value==null || !Number.isFinite(Number(value)) ? '—' : metric.money ? formatMoney(value) : Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
