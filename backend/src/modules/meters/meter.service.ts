import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import type { Prisma, MeterType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMeterDto } from './dto/create-meter.dto.js';
import { UpdateMeterDto } from './dto/update-meter.dto.js';
import { QueryMetersDto } from './dto/query-meters.dto.js';
import { METER_ADAPTER, type MeterAdapter } from './adapters/meter-adapter.js';
import { ManualMeterAdapter } from './adapters/manual-meter.adapter.js';

@Injectable()
export class MeterService {
  private readonly meterAdapter: MeterAdapter;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(METER_ADAPTER) meterAdapter?: MeterAdapter,
  ) {
    this.meterAdapter = meterAdapter ?? new ManualMeterAdapter(prisma);
  }

  /** 按当前适配器取最新读数。结算仍直接查库，因为要和事务锁放在一起。 */
  fetchReading(meterId: string) {
    return this.meterAdapter.fetchReading(meterId);
  }

  async create(dto: CreateMeterDto) {
    // 验证楼栋存在
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) throw new BadRequestException('楼栋不存在');

    // 验证表号唯一性
    const existing = await this.prisma.meter.findUnique({ where: { meterNumber: dto.meterNumber } });
    if (existing) throw new ConflictException('表号已存在');

    return this.prisma.$transaction(async (tx) => {
      const meter = await tx.meter.create({
        data: {
          buildingId: dto.buildingId,
          roomId: dto.roomId,
          publicAreaId: dto.publicAreaId,
          meterType: dto.meterType as MeterType,
          meterNumber: dto.meterNumber,
          unitPrice: dto.unitPrice,
          priceEffectiveDate: new Date(dto.priceEffectiveDate),
        },
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
            readingTime: new Date(dto.priceEffectiveDate || Date.now()),
            readBy: 'SYSTEM',
            notes: '[INITIAL] 设备绑定登记初始底数',
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

  async update(id: string, dto: UpdateMeterDto) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) throw new NotFoundException('水电表不存在');

    const updateData: Prisma.MeterUpdateInput = {};
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
}
