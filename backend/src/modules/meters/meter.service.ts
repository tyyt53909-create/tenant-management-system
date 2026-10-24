import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, MeterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { SetMeterPriceDto } from './dto/set-meter-price.dto.js';
import { SetMeterDefaultPriceDto } from './dto/set-meter-default-price.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { METER_ADAPTER, type MeterAdapter } from './adapters/meter-adapter.js';
import { ManualMeterAdapter } from './adapters/manual-meter.adapter.js';
import { MeterPriceService } from './meter-price.service.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';

@Injectable()
export class MeterService {
  private readonly meterAdapter: MeterAdapter;
  private readonly priceService: MeterPriceService;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(METER_ADAPTER) meterAdapter?: MeterAdapter,
    @Optional() priceService?: MeterPriceService,
  ) {
    this.meterAdapter = meterAdapter ?? new ManualMeterAdapter(prisma);
    this.priceService =
      priceService ?? new MeterPriceService(prisma, new BusinessClock(new ConfigService()));
  }

  /** 按当前适配器取最新读数。结算仍直接查库，因为要和事务锁放在一起。 */
  fetchReading(meterId: string) {
    return this.meterAdapter.fetchReading(meterId);
  }

  async create(dto: CreateMeterDto, operatorId = 'SYSTEM') {
    // 验证楼栋存在
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) throw new BadRequestException('楼栋不存在');

    // 验证表号唯一性
    const existing = await this.prisma.meter.findUnique({ where: { meterNumber: dto.meterNumber } });
    if (existing) throw new ConflictException('表号已存在');

    return this.prisma.$transaction(async (tx) => {
      const effectiveDate = this.priceService.toDateOnly(dto.priceEffectiveDate);
      // 未传单价时使用设置中心的类型默认价（T276）；两者都没有则明确拒绝
      const unitPrice =
        dto.unitPrice ?? (await this.priceService.resolveTypeDefault(dto.meterType, effectiveDate, tx));
      if (unitPrice == null) {
        throw new BadRequestException(
          '未提供单价，且该表类型尚未配置默认价；请先在设置中心配置水电默认价',
        );
      }
      const meter = await tx.meter.create({
        data: {
          buildingId: dto.buildingId,
          roomId: dto.roomId,
          publicAreaId: dto.publicAreaId,
          meterType: dto.meterType as MeterType,
          meterNumber: dto.meterNumber,
          unitPrice,
          priceEffectiveDate: effectiveDate,
        },
      });

      // 初始价进入历史表：后续调价不影响本次生效日之前的历史读数（T274）
      await this.priceService.recordPriceChange(tx, {
        meterId: meter.id,
        meterType: meter.meterType,
        unitPrice: meter.unitPrice,
        effectiveDate,
        createdBy: operatorId,
      });

      // 设备绑定登记初始底数（不计费，作为后续起步值）
      if (dto.initialReading !== undefined && dto.initialReading !== null) {
        await tx.meterReading.create({
          data: {
            meterId: meter.id,
            currentReading: dto.initialReading,
            previousReading: dto.initialReading,
            usage: 0,
            source: 'MANUAL',
            readingTime: effectiveDate,
            readBy: 'SYSTEM',
            notes: '[INITIAL] 设备绑定登记初始底数',
            dedupKey: `initial:${meter.id}:${effectiveDate.toISOString()}`,
            settledAt: effectiveDate,
            settledUsage: 0,
            settledUnitPrice: meter.unitPrice,
            settledAmount: 0,
          },
        });
      }

      return meter;
    });
  }

  async findAll(query: QueryMetersDto) {
    const { page = 1, limit = 20, meterType, buildingId, roomId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MeterWhereInput = {};
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
          readings: { orderBy: [{readingTime:'desc'}, {createdAt:'desc'}], take: 1,
            select: { currentReading:true,previousReading:true,usage:true,readingTime:true } },
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

  async update(id: string, dto: UpdateMeterDto, operatorId = 'SYSTEM') {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const priceChanged = dto.unitPrice !== undefined || dto.priceEffectiveDate !== undefined;
    const effectiveDate = priceChanged
      ? this.priceService.toDateOnly(dto.priceEffectiveDate ?? new Date())
      : null;

    const updateData: Prisma.MeterUpdateInput = {};
    if (dto.unitPrice !== undefined) updateData.unitPrice = dto.unitPrice;
    if (effectiveDate) updateData.priceEffectiveDate = effectiveDate;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meter.update({ where: { id }, data: updateData });
      if (priceChanged) {
        await this.priceService.recordPriceChange(tx, {
          meterId: id,
          meterType: updated.meterType,
          unitPrice: updated.unitPrice,
          effectiveDate: effectiveDate ?? updated.priceEffectiveDate,
          createdBy: operatorId,
        });
      }
      return updated;
    });
  }

  /**
   * 调价（T274）：写历史 + 更新当前价，历史读数仍按各自生效日计价。
   * 与 `PATCH /meters/:id` 携带 unitPrice 等价，但语义更明确，前端应使用本接口。
   */
  async setPrice(id: string, dto: SetMeterPriceDto, operatorId: string) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const effectiveDate = this.priceService.toDateOnly(dto.effectiveDate);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.meter.update({
        where: { id },
        data: { unitPrice: dto.unitPrice, priceEffectiveDate: effectiveDate },
      });
      const price = await this.priceService.recordPriceChange(tx, {
        meterId: id,
        meterType: updated.meterType,
        unitPrice: dto.unitPrice,
        effectiveDate,
        createdBy: operatorId,
      });
      return { meter: updated, price };
    });
  }

  async priceHistory(id: string) {
    const history = await this.priceService.history(id);
    if (!history) throw new NotFoundException('水电表不存在');
    return history;
  }

  /** 设置中心：各表类型当前默认价 */
  async listTypeDefaults() {
    return this.priceService.listTypeDefaults();
  }

  /** 设置中心：写入类型默认价（meterId 为空），并审计 before/after（T276） */
  async setTypeDefault(
    dto: SetMeterDefaultPriceDto,
    actor: { userId: string; ip: string; userAgent: string },
  ) {
    const effectiveDate = this.priceService.toDateOnly(dto.effectiveDate);

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.meterPriceHistory.findFirst({
        where: { meterId: null, meterType: dto.meterType, effectiveDate },
        orderBy: { createdAt: 'desc' },
      });
      const price = await this.priceService.recordPriceChange(tx, {
        meterId: null,
        meterType: dto.meterType,
        unitPrice: dto.unitPrice,
        effectiveDate,
        createdBy: actor.userId,
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId || null,
          action: 'UPDATE_METER_DEFAULT_PRICE',
          entityType: 'MeterPriceHistory',
          entityId: `${dto.meterType}:${effectiveDate.toISOString().slice(0, 10)}`,
          changes: {
            before: before ? { unitPrice: before.unitPrice } : null,
            after: { unitPrice: price.unitPrice, effectiveDate },
          } as never,
          ip: actor.ip || 'unknown',
          userAgent: actor.userAgent || 'unknown',
        },
      });
      return price;
    });
  }

  async remove(id: string) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');
    await this.prisma.meter.delete({ where: { id } });
    return { message: '水电表已删除' };
  }
}
