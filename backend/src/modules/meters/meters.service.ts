import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { CreateMeterReadingDto } from './dto/create-meter-reading.dto.js';
import { QueryMeterReadingsDto } from './dto/query-meter-readings.dto.js';

/** 表类型 → 费用名称（用于扣费流水描述） */
const METER_TYPE_LABEL: Record<string, string> = {
  ELECTRICITY: '电费',
  WATER: '水费',
  GAS: '燃气费',
};

@Injectable()
export class MetersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMeterDto) {
    // 验证楼栋存在
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) throw new BadRequestException('楼栋不存在');

    // 验证表号唯一性
    const existing = await this.prisma.meter.findUnique({ where: { meterNumber: dto.meterNumber } });
    if (existing) throw new ConflictException('表号已存在');

    return this.prisma.meter.create({
      data: {
        buildingId: dto.buildingId,
        roomId: dto.roomId,
        publicAreaId: dto.publicAreaId,
        meterType: dto.meterType as any,
        meterNumber: dto.meterNumber,
        unitPrice: dto.unitPrice,
        priceEffectiveDate: new Date(dto.priceEffectiveDate),
      },
    });
  }

  async findAll(query: QueryMetersDto) {
    const { page = 1, limit = 20, meterType, buildingId, roomId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (meterType) where.meterType = meterType;
    if (buildingId) where.buildingId = buildingId;
    if (roomId) where.roomId = roomId;

    const [data, total] = await Promise.all([
      this.prisma.meter.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          building: { select: { name: true } },
        },
      }),
      this.prisma.meter.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const meter = await this.prisma.meter.findUnique({
      where: { id },
      include: { room: true, building: true, readings: { take: 10, orderBy: { readingTime: 'desc' } } },
    });
    if (!meter) throw new NotFoundException('水电表不存在');
    return meter;
  }

  async update(id: string, dto: UpdateMeterDto) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const updateData: any = {};
    if (dto.unitPrice !== undefined) updateData.unitPrice = dto.unitPrice;
    if (dto.priceEffectiveDate) updateData.priceEffectiveDate = new Date(dto.priceEffectiveDate);
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    return this.prisma.meter.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');
    await this.prisma.meter.delete({ where: { id } });
    return { message: '水电表已删除' };
  }

  /**
   * 水電讀數登記（docs/02-数据模型.md §2.14）
   * - 自動取上一條讀數作為 previousReading，計算 usage
   * - 房間關聯預付帳戶時自動扣費（用量 × 當前單價）
   * - 餘額不足：先扣盡餘額，差額生成 UTILITY 補繳帳單（dueDate = 讀數日 + 7 天）
   * - 公共區域表按運營成本處理，不扣費（docs/09-待确认清单.md §7）
   */
  async createReading(meterId: string, dto: CreateMeterReadingDto, operatorId: string) {
    const readingTime = dto.readingTime ? new Date(dto.readingTime) : new Date();

    return this.prisma.$transaction(async (tx) => {
      const meter = await tx.meter.findUnique({ where: { id: meterId } });

      if (!meter) {
        throw new NotFoundException('水电表不存在');
      }

      if (!meter.isActive) {
        throw new BadRequestException('水电表已停用，不能登记读数');
      }

      const previous = await tx.meterReading.findFirst({
        where: { meterId },
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      });

      const previousReading = previous ? Number(previous.currentReading) : 0;

      if (dto.currentReading < previousReading) {
        throw new BadRequestException(
          `当前读数（${dto.currentReading}）不能小于上次读数（${previousReading}）`,
        );
      }

      const usage = Math.round((dto.currentReading - previousReading) * 100) / 100;

      const reading = await tx.meterReading.create({
        data: {
          meterId,
          currentReading: dto.currentReading,
          previousReading,
          usage,
          source: 'MANUAL',
          readingTime,
          readBy: operatorId,
          notes: dto.notes,
        },
      });

      const deduction = await this.applyReadingDeduction(tx, meter, reading, usage, operatorId);

      return { reading, deduction };
    });
  }

  /**
   * 讀數歷史（分頁，按讀數時間倒序）
   */
  async findReadings(meterId: string, query: QueryMeterReadingsDto) {
    const meter = await this.prisma.meter.findUnique({ where: { id: meterId } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.meterReading.findMany({
        where: { meterId },
        skip,
        take: limit,
        orderBy: [{ readingTime: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.meterReading.count({ where: { meterId } }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * 讀數扣費：用量 × 當前單價
   * - 有生效合同 + 預付帳戶：先扣盡可用餘額（條件更新防並發），差額 → UTILITY 補繳帳單
   * - 無合同 / 無帳戶 / 公共區域 / 用量為 0：不扣費（返回原因）
   */
  private async applyReadingDeduction(
    tx: Prisma.TransactionClient,
    meter: { id: string; meterType: string; meterNumber: string; unitPrice: number; roomId: string | null },
    reading: { id: string; readingTime: Date },
    usage: number,
    operatorId: string,
  ) {
    if (!meter.roomId) {
      return { applied: false, reason: '公共区域表按运营成本处理，不扣费' };
    }

    const amount = Math.round(usage * meter.unitPrice);
    if (amount <= 0) {
      return { applied: false, reason: '用量为 0，无扣费' };
    }

    const contract = await tx.contract.findFirst({
      where: { roomId: meter.roomId, status: 'ACTIVE' },
    });
    if (!contract) {
      return { applied: false, reason: '未找到生效合同，未扣费' };
    }

    const account = await tx.prepayAccount.findUnique({
      where: { tenantId_roomId: { tenantId: contract.tenantId, roomId: meter.roomId } },
    });
    if (!account) {
      return { applied: false, reason: '该房间租客无预付账户，未扣费' };
    }

    // 先扣盡可用餘額（條件更新防並發透支）
    let deducted = 0;
    if (account.balanceCache > 0) {
      const candidate = Math.min(account.balanceCache, amount);
      const result = await tx.prepayAccount.updateMany({
        where: { id: account.id, balanceCache: { gte: candidate } },
        data: { balanceCache: { decrement: candidate } },
      });
      deducted = result.count > 0 ? candidate : 0;
    }

    let prepayTransaction = null;
    if (deducted > 0) {
      const updatedAccount = await tx.prepayAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      const typeLabel = METER_TYPE_LABEL[meter.meterType] ?? '水电费';
      prepayTransaction = await tx.prepayTransaction.create({
        data: {
          accountId: account.id,
          type: 'DEDUCTION',
          amount: -deducted,
          balanceAfter: updatedAccount.balanceCache,
          relatedId: reading.id,
          relatedType: 'METER_READING',
          description: `${this.formatPeriod(reading.readingTime)} ${typeLabel}扣费（${meter.meterNumber}）`,
          operatorId,
        },
      });
    }

    const shortfall = amount - deducted;
    let bill = null;
    if (shortfall > 0) {
      const dueDate = new Date(reading.readingTime);
      dueDate.setDate(dueDate.getDate() + 7);

      bill = await tx.bill.create({
        data: {
          contractId: contract.id,
          billNumber: `B${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
          billType: 'UTILITY',
          period: this.formatPeriod(reading.readingTime),
          amount: shortfall,
          dueDate,
          snapshot: {
            meterId: meter.id,
            meterNumber: meter.meterNumber,
            meterType: meter.meterType,
            readingId: reading.id,
            usage,
            unitPrice: meter.unitPrice,
            totalAmount: amount,
            deducted,
            shortfall,
            reason: '预付账户余额不足，补缴差额',
          },
        },
      });
    }

    return { applied: true, amount, deducted, shortfall, prepayTransaction, bill };
  }

  private formatPeriod(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
