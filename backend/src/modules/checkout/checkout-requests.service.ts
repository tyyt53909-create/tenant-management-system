import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import type { Prisma, CheckoutRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { randomHex } from '../../common/utils/secure-random.js';
import { CreateCheckoutRequestDto } from './dto/create-checkout-request.dto.js';
import { ReviewCheckoutRequestDto } from './dto/review-checkout-request.dto.js';
import { QueryCheckoutRequestsDto } from './dto/query-checkout-requests.dto.js';

@Injectable()
export class CheckoutRequestsService {
  private readonly logger = new Logger(CheckoutRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateCheckoutRequestDto, tenantId: string) {
    const scope = scopedWhere(tenantId);

    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
      include: {
        room: true,
        tenant: true,
      },
    });

    if (!contract || contract.tenantId !== scope.tenantId) {
      throw new BadRequestException('关联合同不存在或不属于当前租客');
    }

    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(`只有生效中的合同可以发起退租申请，当前合同状态为 ${contract.status}`);
    }

    // 检查是否有待处理的申请
    const existing = await this.prisma.checkoutRequest.findFirst({
      where: {
        contractId: dto.contractId,
        status: 'PENDING',
      },
    });
    if (existing) {
      throw new ConflictException('该合同已有正在审核中的退租申请，请勿重复发起');
    }

    // 校验提前退租天数
    const minAdvanceDays =
      (await this.settings.getValue<number>('leasing.minCheckoutAdvanceDays')) || 0;
    const expectedDate = new Date(dto.expectedCheckoutDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((expectedDate.getTime() - today.getTime()) / (86400 * 1000));
    if (minAdvanceDays > 0 && diffDays < minAdvanceDays) {
      throw new BadRequestException(`退租申请需至少提前 ${minAdvanceDays} 天发起`);
    }

    const requestNumber = `CR${Date.now()}${randomHex(3).toUpperCase()}`;

    return this.prisma.checkoutRequest.create({
      data: {
        requestNumber,
        contractId: contract.id,
        roomId: contract.roomId,
        tenantId: contract.tenantId,
        expectedCheckoutDate: expectedDate,
        reasonType: dto.reasonType,
        reasonDetail: dto.reasonDetail,
        refundAccount: dto.refundAccount as Prisma.InputJsonValue,
        status: 'PENDING',
      },
      include: {
        room: { select: { roomNumber: true } },
        contract: { select: { contractNumber: true } },
      },
    });
  }

  async findAll(query: QueryCheckoutRequestsDto) {
    const { page = 1, limit = 20, status, contractId, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CheckoutRequestWhereInput = {};
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;
    if (tenantId) where.tenantId = tenantId;

    const [data, total] = await Promise.all([
      this.prisma.checkoutRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          tenant: { select: { name: true, phone: true } },
          contract: { select: { contractNumber: true } },
          checkoutRecord: { select: { id: true, status: true, totalRefund: true } },
        },
      }),
      this.prisma.checkoutRequest.count({ where }),
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

  async findByTenant(tenantId: string, query: QueryCheckoutRequestsDto) {
    const { page = 1, limit = 20, status, contractId } = query;
    const skip = (page - 1) * limit;

    const where: any = scopedWhere(tenantId);
    if (status) where.status = status;
    if (contractId) where.contractId = contractId;

    const [data, total] = await Promise.all([
      this.prisma.checkoutRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          contract: { select: { contractNumber: true } },
          checkoutRecord: { select: { id: true, status: true } },
        },
      }),
      this.prisma.checkoutRequest.count({ where }),
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
    const request = await this.prisma.checkoutRequest.findUnique({
      where: { id },
      include: {
        room: true,
        tenant: true,
        contract: true,
        checkoutRecord: { include: { items: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('退租申请不存在');
    }

    return request;
  }

  async findOneForTenant(id: string, tenantId?: string) {
    const scope = scopedWhere(tenantId);
    const request = await this.prisma.checkoutRequest.findUnique({
      where: { id },
      include: {
        room: true,
        contract: true,
        checkoutRecord: { include: { items: true } },
      },
    });

    if (!request || request.tenantId !== scope.tenantId) {
      throw new NotFoundException('退租申请不存在');
    }

    return request;
  }

  async review(id: string, dto: ReviewCheckoutRequestDto, operatorId: string) {
    const request = await this.prisma.checkoutRequest.findUnique({
      where: { id },
      include: {
        contract: true,
        tenant: true,
        room: true,
      },
    });

    if (!request) {
      throw new NotFoundException('退租申请不存在');
    }

    if (request.status !== 'PENDING') {
      throw new ConflictException(`该退租申请已被处理或撤销（当前状态：${request.status}）`);
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      if (dto.approved) {
        // 审批通过：自动生成或关联 CheckoutRecord
        let checkoutRecordId = request.checkoutRecordId;
        if (!checkoutRecordId) {
          const newRecord = await tx.checkoutRecord.create({
            data: {
              contractId: request.contractId,
              roomId: request.roomId,
              checkoutDate: request.expectedCheckoutDate,
              totalRefund: 0,
              processedBy: operatorId,
              notes: `依据退租申请（${request.requestNumber}）自动生成草稿`,
            },
          });
          checkoutRecordId = newRecord.id;
        }

        const updated = await tx.checkoutRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            handledBy: operatorId,
            handledAt: now,
            checkoutRecordId,
          },
          include: {
            room: true,
            tenant: true,
            checkoutRecord: true,
          },
        });

        if (request.tenant.userId) {
          await this.notifications
            .create({
              userId: request.tenant.userId,
              title: '退租申请已通过',
              body: `您的退租申请（${request.requestNumber}）已由管理员审核通过，后续将进行交接验房与结算。`,
              priority: 'NORMAL' as any,
              data: { requestId: id, checkoutRecordId },
            })
            .catch(() => {});
        }

        return updated;
      } else {
        // 审批驳回
        const updated = await tx.checkoutRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectReason: dto.rejectReason || '未提供具体原因',
            handledBy: operatorId,
            handledAt: now,
          },
          include: {
            room: true,
            tenant: true,
          },
        });

        if (request.tenant.userId) {
          await this.notifications
            .create({
              userId: request.tenant.userId,
              title: '退租申请未通过',
              body: `您的退租申请（${request.requestNumber}）未能通过审批，原因：${dto.rejectReason || '无'}。如有疑问请联系管家。`,
              priority: 'URGENT' as any,
              data: { requestId: id },
            })
            .catch(() => {});
        }

        return updated;
      }
    });
  }

  async cancel(id: string, tenantId?: string) {
    const scope = scopedWhere(tenantId);
    const request = await this.prisma.checkoutRequest.findUnique({
      where: { id },
    });

    if (!request || request.tenantId !== scope.tenantId) {
      throw new NotFoundException('退租申请不存在');
    }

    if (request.status !== 'PENDING') {
      throw new ConflictException(`只有待审核状态的退租申请可以撤回（当前状态：${request.status}）`);
    }

    return this.prisma.checkoutRequest.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
    });
  }
}
