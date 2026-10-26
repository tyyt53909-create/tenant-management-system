import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Prisma, RenewalOfferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ContractsService } from './contracts.service.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { randomHex } from '../../common/utils/secure-random.js';
import {
  SubmitRenewalIntentDto,
  QueryRenewalIntentsDto,
} from './dto/submit-renewal-intent.dto.js';
import {
  CreateRenewalOfferDto,
  RespondRenewalOfferDto,
  QueryRenewalOffersDto,
} from './dto/renewal-offer.dto.js';

@Injectable()
export class ContractRenewalsService {
  private readonly logger = new Logger(ContractRenewalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => ContractsService))
    private readonly contractsService: ContractsService,
  ) {}

  /** 租客登记或更新本人的续约意向（LSE-04） */
  async submitRenewalIntent(
    contractId: string,
    tenantId: string,
    dto: SubmitRenewalIntentDto,
  ) {
    const scope = scopedWhere(tenantId);
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { tenant: true, room: true },
    });

    if (!contract || contract.tenantId !== scope.tenantId) {
      throw new BadRequestException('合同不存在或不属于当前租客');
    }

    if (contract.status !== 'ACTIVE' && contract.status !== 'EXPIRED') {
      throw new BadRequestException(`只有生效中或刚到期的合同可提交续约意向，当前状态为 ${contract.status}`);
    }

    const existing = await this.prisma.renewalIntent.findFirst({
      where: { contractId },
    });

    if (existing) {
      return this.prisma.renewalIntent.update({
        where: { id: existing.id },
        data: {
          intent: dto.intent,
          expectedMonths: dto.expectedMonths,
          expectedRent: dto.expectedRent,
          notes: dto.notes,
        },
      });
    }

    return this.prisma.renewalIntent.create({
      data: {
        contractId,
        tenantId: contract.tenantId,
        intent: dto.intent,
        expectedMonths: dto.expectedMonths,
        expectedRent: dto.expectedRent,
        notes: dto.notes,
      },
    });
  }

  /** 获取单个合同的续约意向 */
  async getRenewalIntent(contractId: string, tenantId?: string, isTenant = true) {
    if (isTenant) {
      const scope = scopedWhere(tenantId);
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        select: { tenantId: true },
      });
      if (!contract || contract.tenantId !== scope.tenantId) {
        throw new NotFoundException('合同不存在');
      }
    }

    const intent = await this.prisma.renewalIntent.findFirst({
      where: { contractId },
      orderBy: { updatedAt: 'desc' },
    });

    return intent || null;
  }

  /** 管理员查询全部续约意向列表 */
  async findAllRenewalIntents(query: QueryRenewalIntentsDto) {
    const { page = 1, limit = 20, intent, contractId, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.RenewalIntentWhereInput = {};
    if (intent) where.intent = intent;
    if (contractId) where.contractId = contractId;
    if (tenantId) where.tenantId = tenantId;

    const [data, total] = await Promise.all([
      this.prisma.renewalIntent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          contract: {
            select: {
              contractNumber: true,
              endDate: true,
              room: { select: { roomNumber: true } },
            },
          },
          tenant: { select: { name: true, phone: true } },
        },
      }),
      this.prisma.renewalIntent.count({ where }),
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

  /** 管理员发起专属续约报价方案（LSE-04） */
  async createRenewalOffer(
    contractId: string,
    operatorId: string,
    dto: CreateRenewalOfferDto,
  ) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { room: true, tenant: true },
    });

    if (!contract) {
      throw new NotFoundException('关联合同不存在');
    }

    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('续约到期日必须晚于续约起始日');
    }

    const offerNumber = `RO${Date.now()}${randomHex(3).toUpperCase()}`;

    const offer = await this.prisma.renewalOffer.create({
      data: {
        offerNumber,
        contractId: contract.id,
        roomId: contract.roomId,
        tenantId: contract.tenantId,
        offeredRent: dto.offeredRent,
        offeredDeposit: dto.offeredDeposit,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        discountNotes: dto.discountNotes,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        status: 'PENDING',
        createdBy: operatorId,
      },
      include: {
        room: { select: { roomNumber: true } },
        contract: { select: { contractNumber: true } },
      },
    });

    // 通知租客收到续约报价
    if (contract.tenant.userId) {
      const rentYuan = (dto.offeredRent / 100).toFixed(2);
      await this.notifications
        .create({
          userId: contract.tenant.userId,
          title: '收到专属续约报价方案',
          body: `管家已为您定制续约方案（月租 ¥${rentYuan}），请在租客端查阅并确认。`,
          priority: 'NORMAL' as any,
          data: { offerId: offer.id, contractId: contract.id },
        })
        .catch((err) => {
          this.logger.error(`通知租客续约报价失败: ${err.message}`);
        });
    }

    return offer;
  }

  /** 管理员查询所有续约报价 */
  async findAllRenewalOffers(query: QueryRenewalOffersDto) {
    const { page = 1, limit = 20, status, contractId, tenantId, roomId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.RenewalOfferWhereInput = {};
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;
    if (tenantId) where.tenantId = tenantId;
    if (roomId) where.roomId = roomId;

    const [data, total] = await Promise.all([
      this.prisma.renewalOffer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          tenant: { select: { name: true, phone: true } },
          contract: { select: { contractNumber: true, endDate: true } },
        },
      }),
      this.prisma.renewalOffer.count({ where }),
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

  /** 租客查询本人的续约报价列表 */
  async findMyRenewalOffers(tenantId: string, query: QueryRenewalOffersDto) {
    const { page = 1, limit = 20, status, contractId } = query;
    const skip = (page - 1) * limit;

    const where: any = scopedWhere(tenantId);
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;

    const [data, total] = await Promise.all([
      this.prisma.renewalOffer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          contract: { select: { contractNumber: true, endDate: true } },
        },
      }),
      this.prisma.renewalOffer.count({ where }),
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

  /** 查询单个报价详情 */
  async findOneRenewalOffer(offerId: string) {
    const offer = await this.prisma.renewalOffer.findUnique({
      where: { id: offerId },
      include: {
        room: true,
        tenant: true,
        contract: true,
      },
    });

    if (!offer) {
      throw new NotFoundException('续约报价不存在');
    }

    return offer;
  }

  /** 租客查询单个报价详情（验证归属） */
  async findOneRenewalOfferForTenant(offerId: string, tenantId?: string) {
    const scope = scopedWhere(tenantId);
    const offer = await this.prisma.renewalOffer.findUnique({
      where: { id: offerId },
      include: {
        room: true,
        contract: true,
      },
    });

    if (!offer || offer.tenantId !== scope.tenantId) {
      throw new NotFoundException('续约报价不存在');
    }

    return offer;
  }

  /** 租客接受或拒绝续约报价方案 */
  async respondRenewalOffer(
    offerId: string,
    tenantId: string,
    dto: RespondRenewalOfferDto,
  ) {
    const scope = scopedWhere(tenantId);
    const offer = await this.prisma.renewalOffer.findUnique({
      where: { id: offerId },
      include: {
        contract: true,
        room: true,
        tenant: true,
      },
    });

    if (!offer || offer.tenantId !== scope.tenantId) {
      throw new NotFoundException('续约报价不存在');
    }

    if (offer.status !== 'PENDING') {
      throw new ConflictException(`该续约报价已被处理或已失效（当前状态：${offer.status}）`);
    }

    if (offer.validUntil && offer.validUntil < new Date()) {
      await this.prisma.renewalOffer.update({
        where: { id: offerId },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('该续约报价已过有效期');
    }

    const now = new Date();

    if (dto.agree) {
      // 接受报价：自动联动生成续签合同草稿
      const renewedContract = await this.contractsService.renew(offer.contractId, {
        rentAmount: offer.offeredRent,
        depositAmount: offer.offeredDeposit,
        startDate: offer.startDate.toISOString().slice(0, 10),
        endDate: offer.endDate.toISOString().slice(0, 10),
      });

      const updated = await this.prisma.renewalOffer.update({
        where: { id: offerId },
        data: {
          status: 'ACCEPTED',
          respondedAt: now,
          renewedContractId: renewedContract.id,
        },
        include: { room: true, contract: true },
      });

      return {
        ...updated,
        renewedContract,
      };
    } else {
      // 拒绝报价
      return this.prisma.renewalOffer.update({
        where: { id: offerId },
        data: {
          status: 'REJECTED',
          rejectReason: dto.rejectReason || '租客拒绝报价',
          respondedAt: now,
        },
        include: { room: true, contract: true },
      });
    }
  }

  /** 管理端撤回报价 */
  async cancelRenewalOffer(offerId: string) {
    const offer = await this.findOneRenewalOffer(offerId);

    if (offer.status !== 'PENDING') {
      throw new ConflictException(`只有待确认的报价可以撤回（当前状态：${offer.status}）`);
    }

    return this.prisma.renewalOffer.update({
      where: { id: offerId },
      data: { status: 'CANCELLED' },
    });
  }

  /** 查询即将到期的合同（LSE-04 管理端看板与预警） */
  async findExpiringContracts(daysAhead = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date(today.getTime() + daysAhead * 86400000);

    const contracts = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: {
          gte: today,
          lte: maxDate,
        },
      },
      orderBy: { endDate: 'asc' },
      include: {
        room: { select: { id: true, roomNumber: true } },
        tenant: { select: { id: true, name: true, phone: true } },
        building: { select: { id: true, name: true } },
        renewalIntents: { orderBy: { updatedAt: 'desc' }, take: 1 },
        renewalOffers: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return contracts.map((c) => {
      const remainingDays = Math.ceil((c.endDate.getTime() - today.getTime()) / 86400000);
      return {
        ...c,
        remainingDays,
        latestIntent: c.renewalIntents[0] || null,
        latestOffer: c.renewalOffers[0] || null,
      };
    });
  }

  /** 检测与查询到期滞留（Holdover）合同（ISS-20） */
  async findHoldoverContracts() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // EXPIRED 且房间仍为 OCCUPIED 的合同
    const expiredContracts = await this.prisma.contract.findMany({
      where: {
        status: 'EXPIRED',
        room: { status: 'OCCUPIED' },
      },
      include: {
        room: { select: { id: true, roomNumber: true, status: true } },
        tenant: { select: { id: true, name: true, phone: true } },
        building: { select: { id: true, name: true } },
        checkoutRecords: { select: { id: true, status: true } },
        renewedTo: { select: { id: true, status: true, contractNumber: true } },
      },
    });

    // 排除已生成新生效合同或已退租完成的记录
    const holdovers = expiredContracts.filter((c) => {
      const hasActiveRenewal = c.renewedTo && c.renewedTo.status === 'ACTIVE';
      const hasCompletedCheckout = c.checkoutRecords.some((chk) => chk.status === 'COMPLETED');
      return !hasActiveRenewal && !hasCompletedCheckout;
    });

    return holdovers.map((c) => {
      const daysOverdue = Math.floor((today.getTime() - c.endDate.getTime()) / 86400000);
      return {
        ...c,
        daysOverdue,
      };
    });
  }
}
