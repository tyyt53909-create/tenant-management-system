import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Prisma, PrepayTransactionType, RelatedType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePrepayAccountDto } from './dto/create-prepay-account.dto.js';
import { UpdatePrepayAccountDto } from './dto/update-prepay-account.dto.js';
import { QueryPrepayAccountsDto } from './dto/query-prepay-accounts.dto.js';
import { CreatePrepayTransactionDto, PrepayTransactionType as PrepayTxType } from './dto/create-prepay-transaction.dto.js';
import { QueryPrepayTransactionsDto } from './dto/query-prepay-transactions.dto.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToYuanString } from '../../common/utils/currency.util.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { formatBusinessDateTime } from '../../common/business-clock/business-clock.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  PAYMENT_PROVIDER,
  type JsapiPaymentParams,
  type PaymentProvider,
} from '../bills/payment/payment-provider.js';
import { BillPaymentService } from '../bills/bill-payment.service.js';
import { PaymentMethod } from '../bills/dto/create-payment.dto.js';
import { randomHex } from '../../common/utils/secure-random.js';

@Injectable()
export class PrepayService {
  private readonly logger = new Logger(PrepayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: BusinessClock,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    @Inject(forwardRef(() => BillPaymentService))
    private readonly billPaymentService: BillPaymentService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreatePrepayAccountDto) {
    // 验证租客存在
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new BadRequestException('租客不存在');

    // 检查唯一性
    const existing = await this.prisma.prepayAccount.findUnique({
      where: { tenantId_roomId: { tenantId: dto.tenantId, roomId: dto.roomId } },
    });
    if (existing) throw new ConflictException('该租客的预付账户已存在');

    // 未显式传阈值时取设置中心默认值（T276）；显式 0 仍然保留（T207）
    const lowBalanceThreshold =
      dto.lowBalanceThreshold ??
      (await this.settings.getValue<number>('prepay.defaultLowBalanceThreshold'));

    return this.prisma.prepayAccount.create({
      data: {
        tenantId: dto.tenantId,
        roomId: dto.roomId,
        lowBalanceThreshold,
      },
    });
  }

  async findAll(query: QueryPrepayAccountsDto) {
    const { page = 1, limit = 20, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PrepayAccountWhereInput = {};
    if (tenantId) where.tenantId = tenantId;

    const [data, total] = await Promise.all([
      this.prisma.prepayAccount.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { name: true, phone: true } } },
      }),
      this.prisma.prepayAccount.count({ where }),
    ]);

    // PrepayAccount 无 room 关联，批量补充房间号
    const roomIds = [...new Set(data.map((account) => account.roomId))];
    const rooms = roomIds.length
      ? await this.prisma.room.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, roomNumber: true },
        })
      : [];
    const roomNumberMap = new Map(rooms.map((room) => [room.id, room.roomNumber]));

    return {
      data: data.map((account) => ({
        ...account,
        roomNumber: roomNumberMap.get(account.roomId) ?? null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const account = await this.prisma.prepayAccount.findUnique({
      where: { id },
      include: { tenant: true, transactions: { take: 20, orderBy: { createdAt: 'desc' } } },
    });
    if (!account) throw new NotFoundException('预付账户不存在');
    return account;
  }

  async update(id: string, dto: UpdatePrepayAccountDto) {
    const account = await this.prisma.prepayAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('预付账户不存在');

    const updateData: Prisma.PrepayAccountUpdateInput = {};
    if (dto.lowBalanceThreshold !== undefined) updateData.lowBalanceThreshold = dto.lowBalanceThreshold;

    return this.prisma.prepayAccount.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const account = await this.prisma.prepayAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('预付账户不存在');

    // FIN-06 / T265：有流水或余额的预付账户属于财务资料，禁止硬删除。
    const transactions = await this.prisma.prepayTransaction.count({ where: { accountId: id } });
    if (transactions > 0 || account.balanceCache !== 0) {
      throw new ConflictException('预付账户存在流水或余额，不能删除；请先结转余额并保留流水');
    }

    await this.prisma.prepayAccount.delete({ where: { id } });
    return { message: '预付账户已删除' };
  }

  // 租客查看自己的账户
  async findByTenant(tenantId: string) {
    const account = await this.prisma.prepayAccount.findFirst({
      where: scopedWhere(tenantId),
      include: {
        tenant: { select: { id: true, name: true } },
      },
    });

    if (!account) {
      throw new NotFoundException('预付账户不存在');
    }

    // PrepayAccount 无 room 关联，单独查询房间号
    const room = await this.prisma.room.findUnique({
      where: { id: account.roomId },
      select: { id: true, roomNumber: true },
    });

    // 计算近 30 天日均扣费与预估可用天数 (PAY-04 / T296)
    const now = this.clock ? this.clock.now() : new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const deductions = (await this.prisma.prepayTransaction.findMany({
      where: {
        accountId: account.id,
        type: 'DEDUCTION',
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { amount: true },
    })) || [];

    const totalDeduction = deductions.reduce((sum, d) => sum + Math.abs(d.amount), 0);
    const dailyAverageUsage = Math.round(totalDeduction / 30);
    const estimatedDaysRemaining =
      dailyAverageUsage > 0
        ? Math.max(0, Math.floor(account.balanceCache / dailyAverageUsage))
        : null;

    return {
      ...account,
      room,
      dailyAverageUsage,
      estimatedDaysRemaining,
    };
  }

  // 租客查看自己的交易记录
  async findTransactionsByTenant(tenantId: string, query?: Partial<QueryPrepayTransactionsDto>) {
    const { page = 1, limit = 20 } = query ?? {};
    const skip = (page - 1) * limit;

    // 先获取租客的账户
    const account = await this.prisma.prepayAccount.findFirst({
      where: scopedWhere(tenantId),
    });

    if (!account) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }

    const [data, total] = await Promise.all([
      this.prisma.prepayTransaction.findMany({
        where: { accountId: account.id },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.prepayTransaction.count({
        where: { accountId: account.id },
      }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // 管理员查看所有交易
  async findAllTransactions(query: QueryPrepayTransactionsDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.prepayTransaction.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          account: {
            include: {
              tenant: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.prepayTransaction.count(),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * 登记预付流水（T136）
   * - RECHARGE：+amount；DEDUCTION / REFUND：-amount（不允许透支）
   * - ADJUSTMENT：按 amount 符号增减（管理员手动修正，可为负，不做余额校验）
   * - 事务内：更新余额缓存 + 写流水（balanceAfter = 操作后余额）
   * - 扣费/退款用条件更新（balanceCache >= 扣减额）防止并发透支
   */
  async recordTransaction(
    accountId: string,
    dto: CreatePrepayTransactionDto,
    operatorId: string,
  ) {
    const signedAmount = this.resolveSignedAmount(dto);

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.prepayAccount.findUnique({ where: { id: accountId } });

      if (!account) {
        throw new NotFoundException('预付账户不存在');
      }

      let updated;

      if (signedAmount > 0) {
        updated = await tx.prepayAccount.update({
          where: { id: accountId },
          data: { balanceCache: { increment: signedAmount } },
        });
      } else if (dto.type === 'ADJUSTMENT') {
        updated = await tx.prepayAccount.update({
          where: { id: accountId },
          data: { balanceCache: { decrement: -signedAmount } },
        });
      } else {
        const result = await tx.prepayAccount.updateMany({
          where: { id: accountId, balanceCache: { gte: -signedAmount } },
          data: { balanceCache: { decrement: -signedAmount } },
        });

        if (result.count === 0) {
          throw apiError(ErrorCode.PREPAY_INSUFFICIENT_BALANCE, '余额不足，无法扣费/退款');
        }

        updated = await tx.prepayAccount.findUniqueOrThrow({ where: { id: accountId } });
      }

      const transaction = await tx.prepayTransaction.create({
        data: {
          accountId,
          type: dto.type as PrepayTransactionType,
          amount: signedAmount,
          balanceAfter: updated.balanceCache,
          relatedId: dto.relatedId,
          relatedType: dto.relatedType ? (dto.relatedType as RelatedType) : undefined,
          description: dto.description,
          operatorId,
        },
      });

      return { transaction, account: updated };
    });
  }

  /**
   * 账户流水（分页，按时间倒序）
   */
  async findAccountTransactions(accountId: string, query: QueryPrepayTransactionsDto) {
    const account = await this.prisma.prepayAccount.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundException('预付账户不存在');
    }

    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.prepayTransaction.findMany({
        where: { accountId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.prepayTransaction.count({ where: { accountId } }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * 按类型决定流水金额方向
   * - RECHARGE / DEDUCTION / REFUND：amount 必须 > 0
   * - ADJUSTMENT：amount ≠ 0（可为负）
   */
  private resolveSignedAmount(dto: CreatePrepayTransactionDto): number {
    if (dto.type === 'ADJUSTMENT') {
      if (dto.amount === 0) {
        throw new BadRequestException('调整金额不能为 0');
      }
      return dto.amount;
    }

    if (dto.amount <= 0) {
      throw new BadRequestException(`${dto.type} 金额必须大于 0`);
    }

    return dto.type === 'RECHARGE' ? dto.amount : -dto.amount;
  }

  /**
   * 预付账户交易流水 CSV 导出
   */
  async exportTransactions(query: Partial<QueryPrepayTransactionsDto>) {
    const where: Prisma.PrepayTransactionWhereInput = {};
    if (query.accountId) where.accountId = query.accountId;
    if (query.type) where.type = query.type as PrepayTransactionType;
    if (query.startDate || query.endDate) {
      where.createdAt = {
        ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
        ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
      };
    }

    const transactions = await this.prisma.prepayTransaction.findMany({
      where,
      include: {
        account: {
          include: {
            tenant: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const roomIds = [...new Set(transactions.map((t) => t.account?.roomId).filter(Boolean))];
    const rooms = roomIds.length
      ? await this.prisma.room.findMany({
          where: { id: { in: roomIds as string[] } },
          select: { id: true, roomNumber: true },
        })
      : [];
    const roomMap = new Map(rooms.map((r) => [r.id, r.roomNumber]));

    const typeLabelMap: Record<string, string> = {
      RECHARGE: '充值',
      DEDUCTION: '扣费',
      REFUND: '退款',
      ADJUSTMENT: '调账',
    };

    type ExportTxItem = (typeof transactions)[number];
    const columns: CsvColumn<ExportTxItem>[] = [
      { header: '流水号', key: 'id' },
      { header: '房间号', formatter: (t) => roomMap.get(t.account?.roomId || '') || '' },
      { header: '租客姓名', formatter: (t) => t.account?.tenant?.name || '' },
      { header: '租客手机', formatter: (t) => t.account?.tenant?.phone || '' },
      { header: '交易类型', formatter: (t) => typeLabelMap[t.type] || t.type },
      { header: '变动金额(元)', formatter: (t) => centsToYuanString(t.amount) },
      { header: '变动后余额(元)', formatter: (t) => centsToYuanString(t.balanceAfter) },
      { header: '第三方交易号', formatter: (t) => ((t as Record<string, unknown>).transactionNumber as string) || t.relatedId || '' },
      { header: '说明', key: 'description' },
      { header: '经办人', key: 'operatorId' },
      { header: '时间', formatter: (t) => (t.createdAt ? formatBusinessDateTime(new Date(t.createdAt)) : '') },
    ];

    return generateCsv(columns, transactions);
  }

  /**
   * 租客发起预付线上充值微信 JSAPI 下单 (PAY-04 / T296)
   */
  async createRechargeJsapiOrder(
    userId: string,
    tenantId: string,
    amount: number,
  ): Promise<JsapiPaymentParams> {
    if (!tenantId) {
      throw new ForbiddenException('当前用户未关联租客档案');
    }

    const account = await this.prisma.prepayAccount.findFirst({
      where: scopedWhere(tenantId),
    });

    if (!account) {
      throw new NotFoundException('尚未开通预付账户');
    }

    if (amount <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }

    // 获取当前租客绑定的微信 openid
    const identity = await this.prisma.userIdentity.findFirst({
      where: { userId, provider: 'WECHAT_MP' },
      select: { providerUserId: true },
    });

    let openid = identity?.providerUserId;
    if (!openid) {
      const isMock =
        !this.paymentProvider ||
        this.paymentProvider.name === 'wechat-mock' ||
        this.configService?.get('WECHAT_PAY_MOCK') === 'true' ||
        this.configService?.get('NODE_ENV') !== 'production';

      if (isMock) {
        openid = `mock_openid_${userId}`;
      } else {
        throw new BadRequestException('未检测到绑定的微信身份，请先在小程序中授权登录');
      }
    }

    const outTradeNo = `PR_${Date.now()}_${randomHex(4)}`;
    const attach = JSON.stringify({
      purpose: 'PREPAY_RECHARGE',
      prepayAccountId: account.id,
      userId,
      tenantId,
    });

    if (!this.paymentProvider?.createJsapiOrder) {
      throw new BadRequestException('当前支付通道不支持微信 JSAPI 线上支付');
    }

    return this.paymentProvider.createJsapiOrder({
      billId: account.id,
      amount,
      description: '栖居生活-预付金充值',
      openid,
      outTradeNo,
      attach,
    });
  }

  /**
   * 微信支付线上充值入账（幂等防重）
   */
  async recordOnlineRecharge(
    accountId: string,
    amount: number,
    outTradeNo: string,
    transactionId?: string,
    operatorId = 'SYSTEM_WECHAT_PAY',
  ) {
    if (amount <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }

    const tradeId = transactionId || outTradeNo;

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.prepayAccount.findUnique({
        where: { id: accountId },
      });
      if (!account) {
        throw new NotFoundException('预付账户不存在');
      }

      // 幂等校验：检查是否已有相同 tradeId 的 RECHARGE 流水
      const existingTx = await tx.prepayTransaction.findFirst({
        where: {
          accountId,
          type: 'RECHARGE',
          relatedId: tradeId,
        },
      });

      if (existingTx) {
        return {
          transaction: existingTx,
          account,
          alreadyProcessed: true,
        };
      }

      const updatedAccount = await tx.prepayAccount.update({
        where: { id: accountId },
        data: { balanceCache: { increment: amount } },
      });

      const transaction = await tx.prepayTransaction.create({
        data: {
          accountId,
          type: 'RECHARGE',
          amount,
          balanceAfter: updatedAccount.balanceCache,
          relatedId: tradeId,
          description: `微信支付线上充值 (单号: ${outTradeNo})`,
          operatorId,
        },
      });

      return {
        transaction,
        account: updatedAccount,
        alreadyProcessed: false,
      };
    });
  }

  /**
   * 主动查询并同步预付充值状态
   */
  async queryAndSyncRecharge(userId: string, tenantId: string, outTradeNo: string) {
    if (!tenantId) {
      throw new ForbiddenException('当前用户未关联租客档案');
    }

    const account = await this.prisma.prepayAccount.findFirst({
      where: scopedWhere(tenantId),
    });

    if (!account) {
      throw new NotFoundException('预付账户不存在');
    }

    if (!this.paymentProvider?.queryOrder) {
      throw new BadRequestException('当前支付通道不支持主动查单');
    }

    const order = await this.paymentProvider.queryOrder(outTradeNo);
    if (!order) {
      throw new NotFoundException('未查到该笔微信支付订单');
    }

    if (order.status === 'SUCCESS' && order.amount) {
      const result = await this.recordOnlineRecharge(
        account.id,
        order.amount,
        outTradeNo,
        order.transactionId,
        userId,
      );
      return {
        status: 'SUCCESS',
        amount: order.amount,
        account: result.account,
        transaction: result.transaction,
      };
    }

    return {
      status: order.status,
      outTradeNo,
    };
  }

  /**
   * 自动扣费引擎（依据设置中心规则执行）
   */
  async autoDeductBills(tenantId?: string): Promise<{ deductedCount: number; totalAmount: number }> {
    const isEnabled = await this.settings.getValue<boolean>('prepay.autoDeductEnabled');
    if (!isEnabled) {
      return { deductedCount: 0, totalAmount: 0 };
    }

    const allowedBillTypes = await this.settings.getValue<string[]>('prepay.autoDeductBillTypes');
    const allowPartial = await this.settings.getValue<boolean>('prepay.autoDeductPartial');

    const accountWhere: Prisma.PrepayAccountWhereInput = {
      balanceCache: { gt: 0 },
    };
    if (tenantId) {
      accountWhere.tenantId = tenantId;
    }

    const accounts = await this.prisma.prepayAccount.findMany({
      where: accountWhere,
    });

    let totalDeductedCount = 0;
    let totalDeductedAmount = 0;

    for (const account of accounts) {
      const bills = await this.prisma.bill.findMany({
        where: {
          contract: { tenantId: account.tenantId },
          status: 'PENDING',
          billType: { in: allowedBillTypes as never },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });

      for (const bill of bills) {
        const currentAccount = await this.prisma.prepayAccount.findUnique({
          where: { id: account.id },
          select: { balanceCache: true },
        });
        if (!currentAccount || currentAccount.balanceCache <= 0) {
          break;
        }

        const outstanding = bill.amount - bill.paidAmount;
        if (outstanding <= 0) continue;

        let deductAmount = 0;
        if (currentAccount.balanceCache >= outstanding) {
          deductAmount = outstanding;
        } else if (allowPartial) {
          deductAmount = currentAccount.balanceCache;
        } else {
          continue;
        }

        if (deductAmount <= 0) continue;

        try {
          const prepayRes = await this.recordTransaction(
            account.id,
            {
              type: PrepayTxType.DEDUCTION,
              amount: deductAmount,
              description: `预付自动抵扣账单(${bill.billNumber})`,
              relatedId: bill.id,
            },
            'SYSTEM_AUTO_DEDUCT',
          );

          if (this.billPaymentService) {
            try {
              await this.billPaymentService.addPayment(
                bill.id,
                {
                  amount: deductAmount,
                  paymentMethod: PaymentMethod.OTHER,
                  transactionNumber: prepayRes.transaction.id,
                  idempotencyKey: `auto_deduct_${bill.id}_${prepayRes.transaction.id}`,
                  notes: `预付账户自动扣费 (流水: ${prepayRes.transaction.id})`,
                },
                'SYSTEM_AUTO_DEDUCT',
              );
            } catch (payErr) {
              await this.recordTransaction(
                account.id,
                {
                  type: PrepayTxType.REFUND,
                  amount: deductAmount,
                  description: `预付自动抵扣失败回滚(${bill.billNumber})`,
                  relatedId: bill.id,
                },
                'SYSTEM_AUTO_DEDUCT',
              );
              throw payErr;
            }
          }

          totalDeductedCount++;
          totalDeductedAmount += deductAmount;
        } catch (e) {
          this.logger.warn(`预付自动扣费失败 (billId=${bill.id}): ${(e as Error).message}`);
        }
      }
    }

    return { deductedCount: totalDeductedCount, totalAmount: totalDeductedAmount };
  }
}
