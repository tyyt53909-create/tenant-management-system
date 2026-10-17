import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, PaymentCycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { QueryContractsDto } from './dto/query-contracts.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import {
  isContractTransitionAllowed,
  roomUpdateForContractTransition,
} from './contract-transitions.js';

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

    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('合同结束日期必须晚于开始日期');
    }

    // 同一房源同时只能有一份未结束的合同。否则两份 DRAFT 会被定时任务一起置为 ACTIVE，
    // 而月账单的幂等键是 contractId+period（不含 roomId）→ 同一房间同一月两笔租金账单（T207）。
    const activeOnRoom = await this.prisma.contract.findFirst({
      where: { roomId: dto.roomId, status: { in: ['DRAFT', 'ACTIVE'] } },
      select: { contractNumber: true, status: true },
    });
    if (activeOnRoom) {
      throw new ConflictException(
        `该房源已有未结束的合同（${activeOnRoom.contractNumber}，状态 ${activeOnRoom.status}），请先处理后再签约`,
      );
    }

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
        paymentCycle: dto.paymentCycle as PaymentCycle,
        paymentDay: dto.paymentDay,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        lateFeeRule: (dto.lateFeeRule || {}) as Prisma.InputJsonValue,
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
        paymentCycle: (dto.paymentCycle ?? original.paymentCycle) as PaymentCycle,
        paymentDay: dto.paymentDay ?? original.paymentDay,
        startDate,
        endDate,
        lateFeeRule: (dto.lateFeeRule ?? original.lateFeeRule ?? {}) as Prisma.InputJsonValue,
        status: 'DRAFT',
        renewedFromId: original.id,
      },
      include: { renewedFrom: { select: { id: true, contractNumber: true } } },
    });
  }

  async findAll(query: QueryContractsDto) {
    const { page = 1, limit = 20, status, tenantId, roomId, buildingId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ContractWhereInput = {};
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
        room: { include: { photos: { select: { id: true, fileUrl: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 20 } } },
        tenant: true,
        building: true,
        renewedTo: { select: { id: true, contractNumber: true } },
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

    const statusChanged = dto.status !== undefined && dto.status !== contract.status;
    // 状态流转校验（docs/04 §2.3）。原先 PATCH 直接写任意 status：TERMINATED 可复活、
    // DRAFT 可跳过生效直接结束，且不碰房间，导致房态与合同不一致（T207）。
    if (statusChanged && !isContractTransitionAllowed(contract.status, dto.status!)) {
      throw new ConflictException(
        `合同状态不允许从 ${contract.status ?? '未知'} 变更为 ${dto.status}（合法流转见 docs/04-状态机.md §2.3）`,
      );
    }

    if (dto.startDate || dto.endDate) {
      const start = dto.startDate ? new Date(dto.startDate) : contract.startDate;
      const end = dto.endDate ? new Date(dto.endDate) : contract.endDate;
      if (end <= start) {
        throw new BadRequestException('合同结束日期必须晚于开始日期');
      }
    }

    const updateData: Prisma.ContractUpdateInput = {};
    if (dto.rentAmount !== undefined) updateData.rentAmount = dto.rentAmount;
    if (dto.depositAmount !== undefined) updateData.depositAmount = dto.depositAmount;
    if (dto.paymentCycle) updateData.paymentCycle = dto.paymentCycle;
    if (dto.paymentDay !== undefined) updateData.paymentDay = dto.paymentDay;
    if (dto.startDate) updateData.startDate = new Date(dto.startDate);
    if (dto.endDate) updateData.endDate = new Date(dto.endDate);
    if (dto.lateFeeRule) updateData.lateFeeRule = dto.lateFeeRule as Prisma.InputJsonValue;
    if (dto.status) updateData.status = dto.status;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contract.update({ where: { id }, data: updateData });

      if (statusChanged) {
        // 房间随动与定时任务共用同一份规则（contract-transitions.ts）
        const room = await tx.room.findUnique({ where: { id: contract.roomId }, select: { status: true } });
        if (room) {
          const roomUpdate = roomUpdateForContractTransition(room, contract.status, dto.status!);
          if (roomUpdate) {
            await tx.room.update({ where: { id: contract.roomId }, data: roomUpdate });
          }
        }
      }

      return updated;
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

    // 此处 where 需按可选筛选条件增量赋值；Prisma 的联合过滤类型无法在填入普通 string 后再收窄，故保留 any（OPT-17 已注释豁免）
    const where: any = scopedWhere(tenantId);
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: true,
          building: { select: { id: true, name: true, address: true, metadata: true } },
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
    const scope = scopedWhere(tenantId);

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
    if (contract.tenantId !== scope.tenantId) {
      throw new NotFoundException('合同不存在');
    }

    return contract;
  }
}
