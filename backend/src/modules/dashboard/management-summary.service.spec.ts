import { UnauthorizedException } from '@nestjs/common';
import { ManagementSummaryService } from './management-summary.service.js';

describe('V3 管理摘要：来源与聚合口径',()=>{
  let prisma:any;let service:ManagementSummaryService;
  beforeEach(()=>{
    prisma={
      room:{groupBy:vi.fn().mockResolvedValue([])},
      tenant:{count:vi.fn().mockResolvedValue(0)},
      contract:{groupBy:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(0)},
      bill:{aggregate:vi.fn().mockResolvedValue({_count:{_all:0},_sum:{amount:null,paidAmount:null}}),count:vi.fn().mockResolvedValue(0)},
      maintenanceRequest:{groupBy:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(0)},
      prepayAccount:{fields:{lowBalanceThreshold:{field:'lowBalanceThreshold'}},aggregate:vi.fn().mockResolvedValue({_count:{_all:0},_sum:{balanceCache:null}}),count:vi.fn().mockResolvedValue(0)},
      meter:{groupBy:vi.fn().mockResolvedValue([])},
      meterReading:{groupBy:vi.fn().mockResolvedValue([]),aggregate:vi.fn().mockResolvedValue({_sum:{usage:null}})},
      checkoutRecord:{groupBy:vi.fn().mockResolvedValue([]),aggregate:vi.fn().mockResolvedValue({_sum:{totalRefund:null}})},
      notification:{groupBy:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(0)},
    };
    service=new ManagementSummaryService(prisma);
  });
  it('无记录时才返回真实零值，不把数据库异常当作空数据',async()=>{
    const result=await service.snapshot('admin');expect(result.rooms.total).toBe(0);expect(result.bills.remaining).toBe(0);expect(result.ownerId).toBe('admin');
    prisma.bill.aggregate.mockRejectedValue(new Error('db down'));
    await expect(service.snapshot('admin')).rejects.toThrow('db down');
  });
  it('缺少管理员身份时不查询任何聚合数据',async()=>{
    await expect(service.snapshot('')).rejects.toThrow(UnauthorizedException);expect(prisma.room.groupBy).not.toHaveBeenCalled();
  });
  it('按全量房态分组，保洁只统计空置房源而不是原型预约任务',async()=>{
    prisma.room.groupBy.mockResolvedValueOnce([{status:'OCCUPIED',_count:{_all:42}},{status:'VACANT',_count:{_all:12}}]).mockResolvedValueOnce([{cleanStatus:'PENDING_CLEAN',_count:{_all:3}}]);
    const result=await service.snapshot('admin');expect(result.rooms).toMatchObject({total:54,occupied:42,vacant:12});expect(result.cleaning).toMatchObject({pending:3,total:3});
    expect(prisma.room.groupBy).toHaveBeenCalledWith(expect.objectContaining({by:['cleanStatus'],where:{status:'VACANT'}}));
  });
  it('账单金额仍为分，取消账单不计入，不虚构月度统计或滞纳金',async()=>{
    prisma.bill.aggregate.mockResolvedValue({_count:{_all:4},_sum:{amount:123450,paidAmount:23450}});
    const result=await service.snapshot('admin');expect(result.bills).toMatchObject({total:4,billed:123450,paid:23450,remaining:100000});
    expect(prisma.bill.aggregate).toHaveBeenCalledWith(expect.objectContaining({where:{status:{not:'CANCELLED'}}}));
  });
  it('每台本月已抄设备只计一次，用水和用电按真实读数时间汇总',async()=>{
    prisma.meter.groupBy.mockResolvedValue([{meterType:'WATER',_count:{_all:2}},{meterType:'ELECTRICITY',_count:{_all:1}}]);
    prisma.meterReading.groupBy.mockResolvedValue([{meterId:'m1',_count:{_all:7}},{meterId:'m2',_count:{_all:2}}]);
    prisma.meterReading.aggregate.mockResolvedValueOnce({_sum:{usage:'32.60'}}).mockResolvedValueOnce({_sum:{usage:'827.25'}});
    const result=await service.snapshot('admin');expect(result.meters).toEqual({total:3,read:2,pending:1,water:32.6,electricity:827.25});
    const query=prisma.meterReading.aggregate.mock.calls[0][0];expect(query.where.readingTime.gte).toBeInstanceOf(Date);expect(query.where.readingTime.lt).toBeInstanceOf(Date);
  });
  it('低余额采用每个账户的字段阈值，未结算金额不代表已退款',async()=>{
    await service.snapshot('admin');expect(prisma.prepayAccount.count).toHaveBeenCalledWith({where:{balanceCache:{lt:prisma.prepayAccount.fields.lowBalanceThreshold}}});
    expect(prisma.checkoutRecord.aggregate).toHaveBeenCalledWith({where:{status:{in:['DRAFT','PENDING']}},_sum:{totalRefund:true}});
  });
  it('通知计数固定当前管理员，不读取其他用户的收件箱',async()=>{
    await service.snapshot('admin-123');expect(prisma.notification.groupBy).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'admin-123'}}));
    expect(prisma.notification.count).toHaveBeenCalledWith({where:{userId:'admin-123',isRead:false,priority:'URGENT'}});
  });
});
