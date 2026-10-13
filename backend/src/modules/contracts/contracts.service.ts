import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { QueryContractsDto } from './dto/query-contracts.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContractDto) {
    // 验证关联数据存在
    const [building, room, tenant] = await Promise.all([
      this.prisma.building.findUnique({ where: { id: dto.buildingId } }),
      this.prisma.room.findUnique({ where: { id: dto.roomId } }),
      this.prisma.tenant.findUnique({ where: { id: dto.tenantId } }),
    ]);

    if (!building) throw new BadRequestException('楼栋不存在');
    if (!room) throw new BadRequestException('房源不存在');
    if (!tenant) throw new BadRequestException('租客不存在');

    // 生成合同编号
    const contractNumber = `C${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    return this.prisma.contract.create({
      data: {
        buildingId: dto.buildingId,
        roomId: dto.roomId,
        tenantId: dto.tenantId,
        contractNumber,
        rentAmount: dto.rentAmount,
        depositAmount: dto.depositAmount,
        paymentCycle: dto.paymentCycle as any,
        paymentDay: dto.paymentDay,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        lateFeeRule: dto.lateFeeRule || {},
      },
    });
  }

  /**
   * 合同续签：复制原合同生成新草稿，并建立 renewedFromId 关联。
   * - 原合同不得已终止/已续签（避免同一合同被重复续签）
   * - 新合同为 DRAFT，待管理者确认后另行置为 ACTIVE
   * - 原合同状态在本步不变，待新合同生效时由管理者处理
   */
  async renew(id: string, dto: RenewContractDto) {
    const original = await this.prisma.contract.findUnique({
      where: { id },
      include: { renewedTo: { select: { id: true } } },
    });

    if (!original) throw new NotFoundException('合同不存在');

    if (original.status === 'TERMINATED') {
      throw new BadRequestException('已终止的合同不能续签');
    }
    if (original.status === 'RENEWED' || original.renewedTo) {
      throw new ConflictException('该合同已续签，请勿重复操作');
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : new Date(new Date(original.endDate).getTime() + 24 * 60 * 60 * 1000);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('新合同到期日必须晚于起始日');
    }

    const contractNumber = `C${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    return this.prisma.contract.create({
      data: {
        buildingId: original.buildingId,
        roomId: original.roomId,
        tenantId: original.tenantId,
        contractNumber,
        rentAmount: dto.rentAmount ?? original.rentAmount,
        depositAmount: dto.depositAmount ?? original.depositAmount,
        paymentCycle: (dto.paymentCycle ?? original.paymentCycle) as any,
        paymentDay: dto.paymentDay ?? original.paymentDay,
        startDate,
        endDate,
        lateFeeRule: dto.lateFeeRule ?? original.lateFeeRule ?? {},
        status: 'DRAFT',
        renewedFromId: original.id,
      },
      include: { renewedFrom: { select: { id: true, contractNumber: true } } },
    });
  }

  async findAll(query: QueryContractsDto) {
    const { page = 1, limit = 20, status, tenantId, roomId, buildingId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (tenantId) where.tenantId = tenantId;
    if (roomId) where.roomId = roomId;
    if (buildingId) where.buildingId = buildingId;

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          tenant: { select: { name: true } },
          building: { select: { name: true } },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        room: true,
        tenant: true,
        building: true,
      },
    });

    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    return contract;
  }

  async update(id: string, dto: UpdateContractDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    const updateData: any = {};
    if (dto.rentAmount !== undefined) updateData.rentAmount = dto.rentAmount;
    if (dto.depositAmount !== undefined) updateData.depositAmount = dto.depositAmount;
    if (dto.paymentCycle) updateData.paymentCycle = dto.paymentCycle;
    if (dto.paymentDay !== undefined) updateData.paymentDay = dto.paymentDay;
    if (dto.startDate) updateData.startDate = new Date(dto.startDate);
    if (dto.endDate) updateData.endDate = new Date(dto.endDate);
    if (dto.lateFeeRule) updateData.lateFeeRule = dto.lateFeeRule;
    if (dto.status) updateData.status = dto.status;

    return this.prisma.contract.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    await this.prisma.contract.delete({ where: { id } });
    return { message: '合同已删除' };
  }

  // 租客查看自己的合同
  async findByTenant(tenantId: string, query: QueryContractsDto) {
    const { page = 1, limit = 20, status } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: true,
          building: { select: { name: true, address: true } },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // 租客查看单个合同（需验证归属）
  async findOneForTenant(id: string, tenantId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        room: true,
        tenant: true,
        building: true,
      },
    });

    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    // 验证合同是否属于该租客
    if (contract.tenantId !== tenantId) {
      throw new NotFoundException('合同不存在');
    }

    return contract;
  }
}
