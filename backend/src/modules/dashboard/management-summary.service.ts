import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { METRIC_CALIBERS, collectionRate, remainingAmount } from '../../common/metrics/finance-metrics.js';

function counts<T extends { _count: { _all: number } }>(rows:T[], field:keyof T) {
  return Object.fromEntries(rows.map(row=>[String(row[field]),row._count._all]));
}
const sumCounts=(values:Record<string,number>)=>Object.values(values).reduce((sum,value)=>sum+value,0);

/** 后台 V3 摘要：全量聚合，不把当前列表页冒充全局统计；金额保持「分」。 */
@Injectable()
export class ManagementSummaryService {
  constructor(
    private readonly prisma:PrismaService,
    private readonly clock:BusinessClock,
  ) {}

  async snapshot(userId:string) {
    if(!userId)throw new UnauthorizedException('缺少当前管理员身份');
    const now=this.clock.now();
    const today=this.clock.todayUtc();
    const horizon=this.clock.addDays(today,30);
    const monthStart=this.clock.startOfMonth(today);
    const monthEnd=this.clock.addMonths(monthStart,1);
    const readingRange={gte:monthStart,lt:monthEnd};
    const openStates=['SUBMITTED','ACKNOWLEDGED','ASSIGNED','IN_PROGRESS','PENDING_CONFIRM'] as const;
    const [roomRows,cleanRows,tenants,enabledTenants,residentTenants,draftTenants,unlinkedTenants,contractRows,expiring,billTotals,overdue,repairRows,urgentRepairs,prepayTotals,lowBalances,negativeBalances,zeroBalances,meterRows,readMeters,water,electricity,checkoutRows,pendingRefund,noticeRows,urgentNotices]=await Promise.all([
      this.prisma.room.groupBy({by:['status'],_count:{_all:true}}),
      this.prisma.room.groupBy({by:['cleanStatus'],where:{status:'VACANT'},_count:{_all:true}}),
      this.prisma.tenant.count(),
      this.prisma.tenant.count({where:{isActive:true}}),
      this.prisma.tenant.count({where:{contracts:{some:{status:'ACTIVE'}}}}),
      this.prisma.tenant.count({where:{AND:[{contracts:{some:{status:'DRAFT'}}},{contracts:{none:{status:'ACTIVE'}}}]}}),
      this.prisma.tenant.count({where:{contracts:{none:{}}}}),
      this.prisma.contract.groupBy({by:['status'],_count:{_all:true}}),
      this.prisma.contract.count({where:{status:'ACTIVE',endDate:{gte:today,lte:horizon}}}),
      this.prisma.bill.aggregate({where:{status:{not:'CANCELLED'}},_count:{_all:true},_sum:{amount:true,paidAmount:true}}),
      this.prisma.bill.count({where:{isOverdue:true,status:{in:['PENDING','PARTIAL']}}}),
      this.prisma.maintenanceRequest.groupBy({by:['status'],_count:{_all:true}}),
      this.prisma.maintenanceRequest.count({where:{priority:'URGENT',status:{in:[...openStates]}}}),
      this.prisma.prepayAccount.aggregate({_count:{_all:true},_sum:{balanceCache:true}}),
      this.prisma.prepayAccount.count({where:{balanceCache:{lt:this.prisma.prepayAccount.fields.lowBalanceThreshold}}}),
      this.prisma.prepayAccount.count({where:{balanceCache:{lt:0}}}),
      this.prisma.prepayAccount.count({where:{balanceCache:0}}),
      this.prisma.meter.groupBy({by:['meterType'],where:{isActive:true},_count:{_all:true}}),
      this.prisma.meterReading.groupBy({by:['meterId'],where:{readingTime:readingRange,source:{not:'SIMULATED'},meter:{isActive:true}},_count:{_all:true}}),
      this.prisma.meterReading.aggregate({where:{readingTime:readingRange,source:{not:'SIMULATED'},meter:{meterType:'WATER'}},_sum:{usage:true}}),
      this.prisma.meterReading.aggregate({where:{readingTime:readingRange,source:{not:'SIMULATED'},meter:{meterType:'ELECTRICITY'}},_sum:{usage:true}}),
      this.prisma.checkoutRecord.groupBy({by:['status'],_count:{_all:true}}),
      this.prisma.checkoutRecord.aggregate({where:{status:{in:['DRAFT','PENDING']}},_sum:{totalRefund:true}}),
      this.prisma.notification.groupBy({by:['isRead'],where:{userId},_count:{_all:true}}),
      this.prisma.notification.count({where:{userId,isRead:false,priority:'URGENT'}}),
    ]);
    const rooms=counts(roomRows,'status');const cleaning=counts(cleanRows,'cleanStatus');
    const contracts=counts(contractRows,'status');const maintenance=counts(repairRows,'status');
    const meters=counts(meterRows,'meterType');const checkout=counts(checkoutRows,'status');const notices=counts(noticeRows,'isRead');
    const billed=billTotals._sum.amount ?? 0;const paid=billTotals._sum.paidAmount ?? 0;
    return {
      generatedAt:now.toISOString(),
      ownerId:userId,
      /** 全量快照口径；与统计页的区间报表不是同一个数，页面不要混用（T275）。 */
      caliber:{scope:'ALL_TIME',billed:METRIC_CALIBERS.billed,paid:METRIC_CALIBERS.paid,remaining:METRIC_CALIBERS.remaining,collectionRate:METRIC_CALIBERS.collectionRate},
      rooms:{total:sumCounts(rooms),occupied:rooms.OCCUPIED ?? 0,vacant:rooms.VACANT ?? 0,maintenance:rooms.MAINTENANCE ?? 0,reserved:rooms.RESERVED ?? 0},
      tenants:{total:tenants,enabled:enabledTenants,residents:residentTenants,drafts:draftTenants,unlinked:unlinkedTenants},
      contracts:{total:sumCounts(contracts),active:contracts.ACTIVE ?? 0,expiring,draft:contracts.DRAFT ?? 0,expired:contracts.EXPIRED ?? 0},
      bills:{total:billTotals._count._all,billed,paid,remaining:remainingAmount(billed,paid),collectionRate:collectionRate(billed,paid),overdue},
      maintenance:{submitted:maintenance.SUBMITTED ?? 0,following:(maintenance.ACKNOWLEDGED ?? 0)+(maintenance.ASSIGNED ?? 0)+(maintenance.IN_PROGRESS ?? 0),confirm:maintenance.PENDING_CONFIRM ?? 0,completed:maintenance.COMPLETED ?? 0,urgent:urgentRepairs},
      cleaning:{pending:cleaning.PENDING_CLEAN ?? 0,progress:cleaning.CLEANING ?? 0,ready:cleaning.CLEAN ?? 0,total:sumCounts(cleaning)},
      prepay:{total:prepayTotals._count._all,balance:prepayTotals._sum.balanceCache ?? 0,low:lowBalances,negative:negativeBalances,zero:zeroBalances},
      meters:{total:sumCounts(meters),read:readMeters.length,pending:Math.max(0,sumCounts(meters)-readMeters.length),water:Number(water._sum.usage ?? 0),electricity:Number(electricity._sum.usage ?? 0)},
      checkout:{total:sumCounts(checkout),draft:checkout.DRAFT ?? 0,pending:checkout.PENDING ?? 0,completed:checkout.COMPLETED ?? 0,refund:pendingRefund._sum.totalRefund ?? 0},
      notifications:{total:sumCounts(notices),unread:notices.false ?? 0,read:notices.true ?? 0,urgent:urgentNotices},
    };
  }
}
