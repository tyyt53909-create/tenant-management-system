import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Prisma, PaymentCycle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { SettingsService } from '../settings/settings.service.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { QueryContractsDto } from './dto/query-contracts.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { AddCoTenantDto } from './dto/co-tenant.dto.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { randomHex } from '../../common/utils/secure-random.js';
import {
  isContractTransitionAllowed,
  roomUpdateForContractTransition,
} from './contract-transitions.js';
import { SchedulerMonthlyBillsService } from '../scheduler/scheduler-monthly-bills.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { ContractTemplatesService } from './contract-templates.service.js';
import {
  ELECTRONIC_SIGN_PROVIDER,
  type ElectronicSignProvider,
} from './sign/electronic-sign-provider.interface.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { centsToChineseRMB, centsToYuanString } from '../../common/utils/currency.util.js';
import { buildContractPdf } from './utils/contract-pdf.builder.js';

const PAYMENT_CYCLE_LABEL: Record<string, string> = {
  MONTHLY: '按月支付 (Monthly)',
  QUARTERLY: '按季支付 (Quarterly)',
  SEMI_ANNUAL: '半年支付 (Semi-Annual)',
  ANNUAL: '按年支付 (Annual)',
};

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rentBills: SchedulerMonthlyBillsService,
    private readonly crypto: CryptoService,
    private readonly templatesService: ContractTemplatesService,
    @Inject(ELECTRONIC_SIGN_PROVIDER) private readonly signProvider: ElectronicSignProvider,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
  ) {}

  /** 脱敏共同承租人信息，不向前端直接暴露明文证件号 */
  private maskContract<T extends { coTenants?: any[] }>(contract: T): T {
    if (!contract || !contract.coTenants) return contract;
    return {
      ...contract,
      coTenants: contract.coTenants.map((c) => ({
        ...c,
        idNumber: undefined,
        idNumberMasked: c.idNumber ? this.crypto.maskStored(c.idNumber) : null,
      })),
    };
  }

  private computeVerifyCode(contractNumber: string, tenantPhone: string, startDate: Date | string): string {
    const secret =
      this.configService.get<string>('JWT_SECRET') || 'qiju-contract-verification-secret';
    const startStr = typeof startDate === 'string' ? startDate : startDate.toISOString();
    return createHmac('sha256', secret)
      .update(`${contractNumber}:${tenantPhone}:${startStr}`)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();
  }

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

    const coTenantsData = (dto.coTenants || []).map((c) => ({
      name: c.name,
      phone: c.phone,
      idType: c.idType,
      idNumber: c.idNumber ? this.crypto.encrypt(c.idNumber) : null,
      relationship: c.relationship,
      isSigner: c.isSigner ?? false,
    }));

    const contract = await this.prisma.contract.create({
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
        templateId: dto.templateId || null,
        ...(coTenantsData.length > 0 ? { coTenants: { create: coTenantsData } } : {}),
      },
      include: {
        coTenants: true,
        template: { select: { id: true, name: true, code: true } },
      },
    });

    return this.maskContract(contract);
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
      include: {
        renewedTo: { select: { id: true } },
        coTenants: true,
      },
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

    // 续签时继承原有共同承租人
    const inheritedCoTenants = (original.coTenants || []).map((c) => ({
      name: c.name,
      phone: c.phone,
      idType: c.idType,
      idNumber: c.idNumber,
      relationship: c.relationship,
      isSigner: c.isSigner,
    }));

    const renewed = await this.prisma.contract.create({
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
        templateId: original.templateId,
        ...(inheritedCoTenants.length > 0 ? { coTenants: { create: inheritedCoTenants } } : {}),
      },
      include: {
        renewedFrom: { select: { id: true, contractNumber: true } },
        coTenants: true,
      },
    });

    return this.maskContract(renewed);
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
          coTenants: true,
          template: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);

    return {
      data: data.map((c) => this.maskContract(c)),
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
        room: {
          include: {
            photos: {
              select: { id: true, fileUrl: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              take: 20,
            },
          },
        },
        tenant: true,
        building: true,
        renewedTo: { select: { id: true, contractNumber: true } },
        coTenants: true,
        template: { select: { id: true, name: true, code: true } },
      },
    });

    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    return this.maskContract(contract);
  }

  async update(id: string, dto: UpdateContractDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    const statusChanged = dto.status !== undefined && dto.status !== contract.status;
    if (statusChanged && !isContractTransitionAllowed(contract.status, dto.status!)) {
      throw new ConflictException(
        `合同状态不允许从 ${contract.status ?? '未知'} 变更为 ${dto.status}（合法流转见 docs/04-状态机.md §2.3）`,
      );
    }

    if ((dto.startDate || dto.paymentCycle) && contract.status !== 'DRAFT') {
      const posted = await this.prisma.bill.findFirst({
        where: { contractId: id, billType: 'RENT', status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      if (posted) {
        throw new ConflictException('已有租金账单的合同不能再改起始日或付款周期，以免改写已入账账期');
      }
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
    if (dto.templateId !== undefined) {
      updateData.template = dto.templateId ? { connect: { id: dto.templateId } } : { disconnect: true };
    }
    if (dto.signStatus) updateData.signStatus = dto.signStatus;

    const updated = await this.prisma.$transaction(async (tx) => {
      let renewedOldId: string | undefined;
      if (statusChanged && dto.status === 'ACTIVE') {
        const other = await this.findOtherOpenContract(tx, contract.roomId, id);
        if (other) {
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

      if (dto.coTenants !== undefined) {
        await tx.contractCoTenant.deleteMany({ where: { contractId: id } });
        if (dto.coTenants.length > 0) {
          await tx.contractCoTenant.createMany({
            data: dto.coTenants.map((c) => ({
              contractId: id,
              name: c.name,
              phone: c.phone,
              idType: c.idType,
              idNumber: c.idNumber ? this.crypto.encrypt(c.idNumber) : null,
              relationship: c.relationship,
              isSigner: c.isSigner ?? false,
            })),
          });
        }
      }

      const saved = await tx.contract.update({
        where: { id },
        data: updateData,
        include: { coTenants: true, template: true },
      });

      if (statusChanged) {
        const room = await tx.room.findUnique({ where: { id: contract.roomId }, select: { status: true } });
        if (room) {
          const roomUpdate = roomUpdateForContractTransition(room, contract.status, dto.status!);
          if (roomUpdate) {
            await tx.room.update({ where: { id: contract.roomId }, data: roomUpdate });
          }
        }
      }

      return saved;
    });

    if (statusChanged && dto.status === 'ACTIVE') {
      await this.rentBills.issueDueRentBills(id);
    }
    return this.maskContract(updated);
  }

  async remove(id: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

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
          coTenants: true,
          template: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);

    return {
      data: data.map((c) => this.maskContract(c)),
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
        coTenants: true,
        template: { select: { id: true, name: true, code: true } },
      },
    });

    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    if (contract.tenantId !== scope.tenantId) {
      throw new NotFoundException('合同不存在');
    }

    return this.maskContract(contract);
  }

  /** 追加共同承租人 */
  async addCoTenant(contractId: string, dto: AddCoTenantDto) {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    const coTenant = await this.prisma.contractCoTenant.create({
      data: {
        contractId,
        name: dto.name,
        phone: dto.phone,
        idType: dto.idType || 'ID_CARD',
        idNumber: dto.idNumber ? this.crypto.encrypt(dto.idNumber) : null,
        relationship: dto.relationship,
        isSigner: dto.isSigner ?? false,
      },
    });

    return {
      ...coTenant,
      idNumber: undefined,
      idNumberMasked: coTenant.idNumber ? this.crypto.maskStored(coTenant.idNumber) : null,
    };
  }

  /** 移除共同承租人 */
  async removeCoTenant(contractId: string, coTenantId: string) {
    const coTenant = await this.prisma.contractCoTenant.findFirst({
      where: { id: coTenantId, contractId },
    });
    if (!coTenant) {
      throw new NotFoundException('共同承租人记录不存在');
    }

    await this.prisma.contractCoTenant.delete({ where: { id: coTenantId } });
    return { success: true, message: '共同承租人已移除' };
  }

  /** 生成合同规范 PDF 1.4 文档 Buffer */
  async generatePdf(id: string, tenantId?: string, role?: string): Promise<Buffer> {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        building: true,
        room: true,
        tenant: true,
        coTenants: true,
        template: true,
      },
    });

    if (!contract) {
      throw new NotFoundException('合同不存在');
    }

    if (role === 'TENANT' && contract.tenantId !== tenantId) {
      throw new ForbiddenException('您无权下载非本人租赁合同');
    }

    const templateContent =
      contract.template?.content ||
      (await this.templatesService.findDefault()).content;

    const startDateStr = contract.startDate.toISOString().slice(0, 10);
    const endDateStr = contract.endDate.toISOString().slice(0, 10);
    const rentAmountYuan = centsToYuanString(contract.rentAmount);
    const depositAmountYuan = centsToYuanString(contract.depositAmount);
    const rentAmountChinese = centsToChineseRMB(contract.rentAmount);
    const depositAmountChinese = centsToChineseRMB(contract.depositAmount);
    const paymentCycleText = PAYMENT_CYCLE_LABEL[contract.paymentCycle] || contract.paymentCycle;

    const coTenantsText =
      (contract.coTenants || [])
        .map((c) => `${c.name} (${c.phone}${c.relationship ? ', ' + c.relationship : ''})`)
        .join('; ') || '无';

    const renderedTerms = this.templatesService.render(templateContent, {
      buildingName: contract.building.name,
      buildingAddress: contract.building.address || '',
      roomNumber: contract.room.roomNumber,
      roomType: contract.room.roomType,
      roomArea: contract.room.area ? String(contract.room.area) : '—',
      tenantName: contract.tenant.name,
      tenantPhone: contract.tenant.phone,
      coTenantsText,
      rentAmountYuan,
      rentAmountChinese,
      depositAmountYuan,
      depositAmountChinese,
      paymentCycleText,
      paymentDay: contract.paymentDay,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    const verifyCode = this.computeVerifyCode(
      contract.contractNumber,
      contract.tenant.phone,
      contract.startDate,
    );

    return buildContractPdf({
      contractNumber: contract.contractNumber,
      status: contract.status,
      signStatus: contract.signStatus,
      signFlowId: contract.signFlowId,
      signedAt: contract.signedAt,
      startDate: startDateStr,
      endDate: endDateStr,
      tenantName: contract.tenant.name,
      tenantPhone: contract.tenant.phone,
      coTenants: (contract.coTenants || []).map((c) => ({
        name: c.name,
        phone: c.phone,
        relationship: c.relationship,
        isSigner: c.isSigner,
        signedAt: c.signedAt,
      })),
      buildingName: contract.building.name,
      buildingAddress: contract.building.address || '',
      roomNumber: contract.room.roomNumber,
      roomType: contract.room.roomType,
      area: contract.room.area ? Number(contract.room.area) : null,
      rentAmountYuan,
      rentAmountChinese,
      depositAmountYuan,
      depositAmountChinese,
      paymentCycleText,
      paymentDay: contract.paymentDay,
      templateName: contract.template?.name,
      terms: renderedTerms,
      verifyCode,
    });
  }

  /** 发起电子签约流程（DEC-05） */
  async initiateSignFlow(contractId: string, operatorId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        building: true,
        room: true,
        tenant: true,
        coTenants: true,
      },
    });

    if (!contract) throw new NotFoundException('合同不存在');

    if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') {
      throw new BadRequestException(`只有草稿或生效中的合同可发起电子签，当前状态为 ${contract.status}`);
    }

    if (contract.signStatus === 'SIGNED') {
      throw new ConflictException('该合同已完成电子签署，请勿重复发起');
    }

    const initResult = await this.signProvider.createSignFlow({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      title: `${contract.building.name} ${contract.room.roomNumber}室 房屋租赁合同`,
      tenant: {
        name: contract.tenant.name,
        phone: contract.tenant.phone,
      },
      coTenants: contract.coTenants.map((c) => ({
        name: c.name,
        phone: c.phone,
        isSigner: c.isSigner,
      })),
    });

    const updated = await this.prisma.contract.update({
      where: { id: contractId },
      data: {
        signStatus: 'SIGNING',
        signFlowId: initResult.flowId,
      },
      include: { coTenants: true, template: true },
    });

    // 通知租客签署
    if (contract.tenant.userId) {
      await this.notificationsService
        .create({
          userId: contract.tenant.userId,
          title: '房屋租赁合同待签署',
          body: `您的房屋租赁合同（${contract.contractNumber}）已生成，请尽快进行在线实名签署。`,
          priority: 'URGENT' as any,
          data: { contractId: contract.id, signUrl: initResult.signUrl },
        })
        .catch((err) => {
          this.logger.error(`通知租客签署失败: ${err.message}`);
        });
    }

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      signStatus: updated.signStatus,
      flowId: initResult.flowId,
      signUrl: initResult.signUrl,
      expiresAt: initResult.expiresAt,
    };
  }

  /** 查询签约进度与详情 */
  async getSignStatus(contractId: string, tenantId?: string, role?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { tenant: true, coTenants: true },
    });

    if (!contract) throw new NotFoundException('合同不存在');
    if (role === 'TENANT' && contract.tenantId !== tenantId) {
      throw new ForbiddenException('您无权查询他人的合同签署状态');
    }

    if (!contract.signFlowId) {
      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        signStatus: contract.signStatus,
        flowId: null,
        message: '该合同尚未发起电子签署流程',
      };
    }

    const providerStatus = await this.signProvider.querySignStatus(contract.signFlowId);

    // 若远端已签署，本地自动同步
    if (providerStatus.status === 'SIGNED' && contract.signStatus !== 'SIGNED') {
      await this.markContractSigned(
        contract.id,
        providerStatus.signedAt ? new Date(providerStatus.signedAt) : new Date(),
        providerStatus.docUrl,
      );
    }

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      signStatus: contract.signStatus === 'SIGNED' ? 'SIGNED' : providerStatus.status,
      flowId: contract.signFlowId,
      signedAt: contract.signedAt,
      docUrl: contract.signDocUrl || providerStatus.docUrl,
      signers: providerStatus.signers,
    };
  }

  /** 模拟在线签名完成（测试与开发调试辅助） */
  async mockCompleteSign(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { tenant: true },
    });
    if (!contract) throw new NotFoundException('合同不存在');

    if (!contract.signFlowId) {
      throw new BadRequestException('该合同尚未发起电子签约流程，请先发起');
    }

    if ('simulateSigned' in this.signProvider) {
      (this.signProvider as any).simulateSigned(contract.signFlowId);
    }

    const now = new Date();
    const docUrl = `/api/public/files/signed-${contract.signFlowId}.pdf`;
    return this.markContractSigned(contractId, now, docUrl);
  }

  /** 第三方电子签 Webhook 回调通知（公网免登录） */
  async handleSignCallback(payload: any) {
    const result = await this.signProvider.handleCallback(payload);
    if (!result.flowId) {
      throw new BadRequestException('回调报文中缺少 flowId');
    }

    const contract = await this.prisma.contract.findFirst({
      where: { signFlowId: result.flowId },
    });

    if (!contract) {
      return { success: false, message: '未找到匹配签约流程的合同' };
    }

    if (result.status === 'SIGNED') {
      await this.markContractSigned(contract.id, result.signedAt || new Date(), result.docUrl);
    } else if (result.status === 'REJECTED') {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: { signStatus: 'REJECTED' },
      });
    }

    return { success: true, message: '电子签约回调处理完成' };
  }

  /** 签署成功内部处理：更新合同状态、自动归档为附件并触发通知 */
  private async markContractSigned(contractId: string, signedAt: Date, docUrl?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { tenant: true, coTenants: true },
    });
    if (!contract) return null;

    const updated = await this.prisma.contract.update({
      where: { id: contractId },
      data: {
        signStatus: 'SIGNED',
        signedAt,
        signDocUrl: docUrl,
      },
      include: { coTenants: true, template: true },
    });

    // 共同签署人签署时间同步
    await this.prisma.contractCoTenant.updateMany({
      where: { contractId, isSigner: true, signedAt: null },
      data: { signedAt },
    });

    // 自动归档至合同附件
    if (docUrl) {
      await this.prisma.contractAttachment
        .create({
          data: {
            contractId,
            type: 'CONTRACT_SCAN',
            fileName: `${contract.contractNumber}_已签署电子合同.pdf`,
            fileUrl: docUrl,
            fileSize: 10240,
            mimeType: 'application/pdf',
            uploadedBy: 'system',
          },
        })
        .catch(() => {});
    }

    if (contract.tenant.userId) {
      await this.notificationsService
        .create({
          userId: contract.tenant.userId,
          title: '房屋租赁合同已签署完成',
          body: `您的房屋租赁合同（${contract.contractNumber}）已成功完成电子签署并归档。`,
          priority: 'NORMAL' as any,
          data: { contractId, docUrl },
        })
        .catch(() => {});
    }

    return this.maskContract(updated);
  }
}
