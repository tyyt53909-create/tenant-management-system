import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, PaymentCycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { SettingsService } from '../settings/settings.service.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { QueryContractsDto } from './dto/query-contracts.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { randomHex } from '../../common/utils/secure-random.js';
import {
  isContractTransitionAllowed,
  roomUpdateForContractTransition,
} from './contract-transitions.js';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async create(dto: CreateContractDto) {
    // 显式传入非空规则优先；空对象/未传则用设置中心的默认规则（T276）
    const lateFeeRule =
      dto.lateFeeRule && Object.keys(dto.lateFeeRule).length > 0
        ? dto.lateFeeRule
        : await this.settings.getValue<Record<string, unknown>>('billing.defaultLateFeeRule');

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
    const activeOnRoom = await this.findOtherOpenContract(this.prisma, dto.roomId);
    if (activeOnRoom) {
      throw new ConflictException(
        `该房源已有未结束的合同（${activeOnRoom.contractNumber}，状态 ${activeOnRoom.status}），请先处理后再签约`,
      );
    }

    // 生成合同编号
    const contractNumber = `C${Date.now()}${randomHex(3)}`;

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
        lateFeeRule: lateFeeRule as Prisma.InputJsonValue,
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
    if (original.status === 'DRAFT') {
      throw new BadRequestException('草稿合同尚未生效，不能续签');
    }
    if (original.status === 'RENEWED' || original.renewedTo) {
      throw new ConflictException('该合同已续签，请勿重复操作');
    }

    const originalEnd = new Date(original.endDate);
    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : new Date(originalEnd.getTime() + 24 * 60 * 60 * 1000);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('新合同到期日必须晚于起始日');
    }
    // 续签不得与原合同重叠：新合同必须从原合同到期日之后开始（日期为闭区间）
    if (startDate <= originalEnd) {
      throw new BadRequestException('续签合同的起始日必须晚于原合同到期日');
    }

    // 同一房源不允许存在其他未结束的 DRAFT（旧索引已改为只约束 ACTIVE，这里由应用层兜底）
    const otherDraft = await this.findOtherOpenContract(this.prisma, original.roomId, original.id);
    if (otherDraft) {
      throw new ConflictException(
        `该房源已有未结束的合同（${otherDraft.contractNumber}，状态 ${otherDraft.status}），请先处理后再续签`,
      );
    }

    const contractNumber = `C${Date.now()}${randomHex(3)}`;

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
      // 同房源唯一未结束合同（docs/04 §2.4）不能只在 create() 检查：续签会为同一房间
      // 新建一份 DRAFT（旧合同仍 ACTIVE），此时若把新 DRAFT 提前置为 ACTIVE，就会同房间
      // 两份 ACTIVE 合同 → 同月两笔租金账单（月账单幂等键是 contractId+period，不含 roomId）。
      let renewedOldId: string | undefined;
      if (statusChanged && dto.status === 'ACTIVE') {
        const other = await this.findOtherOpenContract(tx, contract.roomId, id);
        if (other) {
          // 续签激活：允许「旧合同 ACTIVE + 新合同 DRAFT」共存，但必须在同一事务内
          // 把旧合同置为 RENEWED，再激活新合同，避免同房间两份 ACTIVE。
          const isRenewalOfActive =
            !!contract.renewedFromId &&
            contract.renewedFromId === other.id &&
            other.status === 'ACTIVE';
          if (!isRenewalOfActive) {
            throw new ConflictException(
              `该房源已有未结束的合同（${other.contractNumber}，状态 ${other.status}），不能同时存在两份生效/草稿合同`,
            );
          }
          const oldEnd = new Date(other.endDate);
          const newStart = dto.startDate ? new Date(dto.startDate) : contract.startDate;
          if (newStart <= oldEnd) {
            throw new ConflictException('续签合同的起始日必须晚于原合同到期日');
          }
          renewedOldId = other.id;
        }
      }

      if (renewedOldId) {
        await tx.contract.update({
          where: { id: renewedOldId },
          data: { status: 'RENEWED' },
        });
      }

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

    // FIN-06 / T265：已有账单/收款/退租等财务关联的合同不得硬删除。
    const [bills, checkouts] = await Promise.all([
      this.prisma.bill.count({ where: { contractId: id } }),
      this.prisma.checkoutRecord.count({ where: { contractId: id } }),
    ]);
    if (bills > 0 || checkouts > 0) {
      throw new ConflictException('合同已有账单或退租记录，不能删除；请保留合同并作废相关单据');
    }

    await this.prisma.contract.delete({ where: { id } });
    return { message: '合同已删除' };
  }

  /**
   * 该房源上另一份「未结束」（DRAFT / ACTIVE）的合同（docs/04 §2.4）。
   *
   * create() 与 update()（状态流转到 ACTIVE）共用同一份判定，避免只堵住一条路径。
   * 接受事务客户端，便于在 `$transaction` 内做检查、把竞态窗口压到最小。
   */
  private findOtherOpenContract(
    client: Pick<Prisma.TransactionClient, 'contract'>,
    roomId: string,
    excludeId?: string,
  ) {
    return client.contract.findFirst({
      where: {
        roomId,
        status: { in: ['DRAFT', 'ACTIVE'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, contractNumber: true, status: true, endDate: true },
    });
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
