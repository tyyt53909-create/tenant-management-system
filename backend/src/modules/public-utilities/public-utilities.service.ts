import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MeterType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { isUniqueConstraintError } from '../../common/utils/prisma-error.js';
import { allocateByArea, type AllocationBase } from './allocation.js';
import { CreatePublicUtilityBillDto } from './dto/create-public-utility-bill.dto.js';
import { QueryPublicUtilityBillDto } from './dto/query-public-utility-bill.dto.js';

const BILL_INCLUDE = {
  allocations: {
    orderBy: { amount: 'desc' },
    select: {
      id: true,
      contractId: true,
      roomId: true,
      baseAreaHundredths: true,
      amount: true,
      room: { select: { roomNumber: true, floor: true } },
      contract: { select: { contractNumber: true, tenant: { select: { id: true, name: true } } } },
    },
  },
} as const;

/**
 * 公共水电分摊（T217，docs/09 §7）。
 *
 * 第一版公共区域水电只记运营成本，不向租客分摊；本模块把它变成可核算的单据：
 * - 按公共表当月用量 × 单价得出总额，或直接录入总额
 * - 分摊基数：计费月内生效中的合同所覆盖房间的建筑面积
 * - 生成后点「生成补缴账单」才真正向各租客开 UTILITY 账单（幂等键防重复）
 */
@Injectable()
export class PublicUtilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(query: QueryPublicUtilityBillDto) {
    const buildingId = await this.resolveBuildingId(query.buildingId);
    const bills = await this.prisma.publicUtilityBill.findMany({
      where: { buildingId, ...(query.period ? { period: query.period } : {}) },
      orderBy: [{ period: 'desc' }, { meterType: 'asc' }],
      include: { ...BILL_INCLUDE, meter: { select: { id: true, meterNumber: true } } },
    });
    return bills.map((bill) => this.shape(bill));
  }

  async findOne(id: string) {
    const bill = await this.prisma.publicUtilityBill.findUnique({
      where: { id },
      include: { ...BILL_INCLUDE, meter: { select: { id: true, meterNumber: true } } },
    });
    if (!bill) throw new NotFoundException('公共费用单据不存在');
    return this.shape(bill);
  }

  /** 预演：返回将要分摊给谁、多少，不落库 */
  async preview(dto: CreatePublicUtilityBillDto) {
    const buildingId = await this.resolveBuildingId(dto.buildingId);
    const { totalAmount, usage, openingReading, closingReading, unitPrice, meterId } = await this.resolveAmount(buildingId, dto);
    const bases = await this.allocationBases(buildingId, dto.meterType as MeterType, dto.period);
    const entries = allocateByArea(totalAmount, bases);

    return {
      buildingId,
      meterType: dto.meterType,
      period: dto.period,
      meterId,
      usage,
      openingReading,
      closingReading,
      unitPrice,
      totalAmount,
      allocations: await this.describeAllocations(entries),
      warnings: bases.length === 0 ? ['该楼栋在此时段没有生效合同，分摊结果为空'] : [],
    };
  }

  async create(
    dto: CreatePublicUtilityBillDto,
    actor: { userId: string; ip: string; userAgent: string },
  ) {
    const buildingId = await this.resolveBuildingId(dto.buildingId);
    const { totalAmount, usage, openingReading, closingReading, unitPrice, meterId } = await this.resolveAmount(buildingId, dto);
    const bases = await this.allocationBases(buildingId, dto.meterType as MeterType, dto.period);

    try {
      const bill = await this.prisma.publicUtilityBill.create({
        data: {
          buildingId,
          meterType: dto.meterType as MeterType,
          period: dto.period,
          meterId,
          openingReading,
          closingReading,
          usage,
          unitPrice,
          totalAmount,
          notes: dto.notes,
          createdById: actor.userId,
          allocations: {
            create: allocateByArea(totalAmount, bases).map((entry) => ({
              contractId: entry.contractId,
              roomId: entry.roomId,
              baseAreaHundredths: entry.baseAreaHundredths,
              amount: entry.amount,
            })),
          },
        },
        include: { ...BILL_INCLUDE, meter: { select: { id: true, meterNumber: true } } },
      });
      await this.audit(actor, 'CREATE', bill.id, { period: dto.period, totalAmount });
      return this.shape(bill);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('该楼栋、表类型与账期的公共费用单据已存在');
      }
      throw error;
    }
  }

  async remove(id: string, actor: { userId: string; ip: string; userAgent: string }) {
    const bill = await this.prisma.publicUtilityBill.findUnique({
      where: { id },
      select: { id: true, billsGeneratedAt: true },
    });
    if (!bill) throw new NotFoundException('公共费用单据不存在');
    if (bill.billsGeneratedAt) {
      throw new BadRequestException('已生成补缴账单的单据不能删除；如需更正请先在账单中取消对应账单');
    }
    await this.prisma.publicUtilityBill.delete({ where: { id } });
    await this.audit(actor, 'DELETE', id, {});
    return { message: '单据已删除' };
  }

  /**
   * 生成补缴账单：对每条分摊创建 UTILITY 账单。
   * 幂等键 `UTILITY:ALLOC:{allocationId}` 保证重复点击不会重复开单。
   */
  async generateBills(id: string, actor: { userId: string; ip: string; userAgent: string }) {
    const bill = await this.prisma.publicUtilityBill.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!bill) throw new NotFoundException('公共费用单据不存在');
    if (bill.billsGeneratedAt) {
      throw new BadRequestException('该单据的补缴账单已生成');
    }

    const dueDate = new Date(Date.UTC(Number(bill.period.slice(0, 4)), Number(bill.period.slice(5, 7)), 10));
    let created = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const allocation of bill.allocations) {
        if (allocation.amount <= 0) continue;
        const existing = await tx.bill.findUnique({
          where: { dedupKey: `UTILITY:ALLOC:${allocation.id}` },
          select: { id: true },
        });
        if (existing) continue;

        const contract = await tx.contract.findUniqueOrThrow({
          where: { id: allocation.contractId },
          select: { id: true, roomId: true, room: { select: { roomNumber: true } } },
        });
        await tx.bill.create({
          data: {
            contractId: contract.id,
            billNumber: `PU-${bill.period}-${contract.room.roomNumber}-${allocation.id.slice(-6)}`,
            billType: 'UTILITY',
            period: bill.period,
            amount: allocation.amount,
            paidAmount: 0,
            snapshot: {
              source: 'PUBLIC_UTILITY_ALLOCATION',
              publicUtilityBillId: bill.id,
              allocationId: allocation.id,
              meterType: bill.meterType,
              period: bill.period,
              totalAmount: bill.totalAmount,
            },
            dueDate,
            status: 'PENDING',
            dedupKey: `UTILITY:ALLOC:${allocation.id}`,
          },
        });
        created++;
      }
      await tx.publicUtilityBill.update({
        where: { id: bill.id },
        data: { billsGeneratedAt: new Date() },
      });
    });

    await this.audit(actor, 'GENERATE_BILLS', id, { created });
    return { message: `已生成 ${created} 笔补缴账单`, created };
  }

  /** 计算总额：给了 meterId 就按当月用量 × 单价，否则用直接录入的总额 */
  private async resolveAmount(buildingId: string, dto: CreatePublicUtilityBillDto) {
    if (dto.meterId) {
      const meter = await this.prisma.meter.findFirst({
        where: { id: dto.meterId, buildingId, meterType: dto.meterType as MeterType },
        select: { id: true, unitPrice: true },
      });
      if (!meter) throw new BadRequestException('公共表不存在或与楼栋/表类型不匹配');

      const { start, end } = monthRange(dto.period);
      const readings = await this.prisma.meterReading.findMany({
        where: { meterId: meter.id, readingTime: { gte: start, lt: end }, source: { not: 'SIMULATED' } },
        orderBy: { readingTime: 'asc' },
        select: { currentReading: true, source: true },
      });
      if (readings.length < 2) {
        throw new BadRequestException('该公共表在本月不足两笔读数，无法计算用量；请先抄表或改为直接录入总额');
      }
      const opening = Number(readings[0].currentReading);
      const closing = Number(readings[readings.length - 1].currentReading);
      const usage = Math.round((closing - opening) * 100) / 100;
      if (usage < 0) throw new BadRequestException('本月末读数小于月初读数，请检查抄表记录');
      const unitPrice = dto.unitPrice ?? meter.unitPrice;
      return {
        totalAmount: Math.round(usage * unitPrice),
        usage,
        openingReading: opening,
        closingReading: closing,
        unitPrice,
        meterId: meter.id,
      };
    }

    if (!dto.totalAmount || dto.totalAmount <= 0) {
      throw new BadRequestException('请提供公共表或直接录入总额');
    }
    return {
      totalAmount: dto.totalAmount,
      usage: null,
      openingReading: null,
      closingReading: null,
      unitPrice: dto.unitPrice ?? 0,
      meterId: null,
    };
  }

  /**
   * 分摊基数：计费月内与房间有重叠的生效合同（ACTIVE）。
   * 面积缺失的房间不参与分摊，并在响应里通过「无基数」体现；避免按 0 面积白拿。
   */
  private async allocationBases(buildingId: string, meterType: MeterType, period: string): Promise<AllocationBase[]> {
    const { start, end } = monthRange(period);
    const contracts = await this.prisma.contract.findMany({
      where: {
        buildingId,
        status: 'ACTIVE',
        startDate: { lt: end },
        endDate: { gte: start },
        room: { area: { not: null } },
      },
      select: { id: true, roomId: true, room: { select: { area: true } } },
      orderBy: { contractNumber: 'asc' },
    });
    return contracts.map((contract) => ({
      contractId: contract.id,
      roomId: contract.roomId,
      baseAreaHundredths: Math.round(Number(contract.room.area) * 100),
    }));
  }

  private async describeAllocations(entries: { contractId: string; roomId: string; baseAreaHundredths: number; amount: number }[]) {
    if (entries.length === 0) return [];
    const [contracts, rooms] = await Promise.all([
      this.prisma.contract.findMany({
        where: { id: { in: entries.map((entry) => entry.contractId) } },
        select: { id: true, contractNumber: true, tenant: { select: { id: true, name: true } } },
      }),
      this.prisma.room.findMany({
        where: { id: { in: entries.map((entry) => entry.roomId) } },
        select: { id: true, roomNumber: true, floor: true },
      }),
    ]);
    const contractMap = new Map(contracts.map((contract) => [contract.id, contract]));
    const roomMap = new Map(rooms.map((room) => [room.id, room]));
    return entries.map((entry) => ({
      ...entry,
      contract: contractMap.get(entry.contractId),
      room: roomMap.get(entry.roomId),
    }));
  }

  private shape<T extends { allocations: { baseAreaHundredths: number }[] }>(bill: T) {
    return {
      ...bill,
      allocations: bill.allocations.map((allocation) => ({
        ...allocation,
        area: allocation.baseAreaHundredths / 100,
      })),
      generated: Boolean((bill as { billsGeneratedAt?: Date | null }).billsGeneratedAt),
      generatedAt: (bill as { billsGeneratedAt?: Date | null }).billsGeneratedAt ?? null,
    };
  }

  private async resolveBuildingId(explicit?: string) {
    const id = explicit?.trim() || process.env.DEFAULT_BUILDING_ID || 'building-001';
    const building = await this.prisma.building.findUnique({ where: { id }, select: { id: true } });
    if (!building) throw new NotFoundException(`楼栋不存在：${id}`);
    return id;
  }

  private audit(
    actor: { userId: string; ip: string; userAgent: string },
    action: string,
    entityId: string,
    changes: Prisma.InputJsonValue,
  ) {
    return this.auditLogService.log({
      userId: actor.userId,
      action: `PUBLIC_UTILITY_${action}`,
      entityType: 'PublicUtilityBill',
      entityId,
      changes,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }
}

function monthRange(period: string) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}
