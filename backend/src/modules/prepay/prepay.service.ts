import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrepayTransactionType, RelatedType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePrepayAccountDto } from './dto/create-prepay-account.dto.js';
import { UpdatePrepayAccountDto } from './dto/update-prepay-account.dto.js';
import { QueryPrepayAccountsDto } from './dto/query-prepay-accounts.dto.js';
import { CreatePrepayTransactionDto } from './dto/create-prepay-transaction.dto.js';
import { QueryPrepayTransactionsDto } from './dto/query-prepay-transactions.dto.js';
import { PrepayJsapiRechargeDto, PrepayQueryRechargeDto } from './dto/wechat-prepay-recharge.dto.js';
import { generateCsv, CsvColumn } from '../../common/utils/csv.util.js';
import { centsToYuanString } from '../../common/utils/currency.util.js';
import { scopedWhere } from '../../common/utils/scoped-where.js';
import { formatBusinessDateTime } from '../../common/business-clock/business-clock.js';
import { BusinessClock } from '../../common/business-clock/business-clock.service.js';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type JsapiPaymentParams,
  type WechatPaymentNotifyResource,
} from '../bills/payment/payment-provider.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { randomHex } from '../../common/utils/secure-random.js';

@Injectable()
export class PrepayService {
  private readonly logger = new Logger(PrepayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: BusinessClock,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
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

    return { ...account, room };
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
   * 微信支付 JSAPI 预付充值下单
   */
  async createJsapiRechargeOrder(
    dto: PrepayJsapiRechargeDto,
    user: { userId: string; role: string; tenantId?: string },
    targetAccountId?: string,
  ): Promise<JsapiPaymentParams & { orderId: string }> {
    if (dto.amount <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }

    let account;
    if (user.role === 'TENANT') {
      const tenantId = user.tenantId ?? '';
      account = await this.prisma.prepayAccount.findFirst({
        where: scopedWhere(tenantId),
        include: { tenant: { select: { id: true, userId: true, name: true } } },
      });
      if (!account) {
        throw new NotFoundException('当前租客未找到对应的预付账户');
      }
    } else {
      if (!targetAccountId) {
        throw new BadRequestException('请指定需要充值的预付账户 ID');
      }
      account = await this.prisma.prepayAccount.findUnique({
        where: { id: targetAccountId },
        include: { tenant: { select: { id: true, userId: true, name: true } } },
      });
      if (!account) {
        throw new NotFoundException('预付账户不存在');
      }
    }

    const tenantUserId = account.tenant.userId ?? user.userId;

    // 获取租客微信 openid
    const identity = await this.prisma.userIdentity.findFirst({
      where: { userId: tenantUserId, provider: 'WECHAT_MP' },
      select: { providerUserId: true },
    });

    let openid = identity?.providerUserId;
    if (!openid) {
      const isMock =
        this.paymentProvider.name === 'wechat-mock' ||
        this.configService.get('WECHAT_PAY_MOCK') === 'true' ||
        this.configService.get('NODE_ENV') !== 'production';
      if (isMock) {
        openid = `mock_openid_${tenantUserId}`;
      } else {
        throw new BadRequestException('未检测到绑定的微信身份，请先在小程序中授权登录');
      }
    }

    const outTradeNo = `PREPAY_${Date.now()}_${randomHex(4)}`;
    const attach = JSON.stringify({
      type: 'PREPAY_RECHARGE',
      accountId: account.id,
      tenantId: account.tenant.id,
      userId: tenantUserId,
    });

    // 数据库创建 PrepayRechargeOrder（PENDING）
    const order = await this.prisma.prepayRechargeOrder.create({
      data: {
        accountId: account.id,
        tenantId: account.tenant.id,
        amount: dto.amount,
        outTradeNo,
        status: 'PENDING',
        channel: 'WECHAT',
        operatorId: user.userId,
      },
    });

    if (!this.paymentProvider.createJsapiOrder) {
      throw new BadRequestException('当前支付通道不支持微信 JSAPI 线上支付');
    }

    const params = await this.paymentProvider.createJsapiOrder({
      amount: dto.amount,
      description: `栖居生活-预付充值(¥${(dto.amount / 100).toFixed(2)})`,
      openid,
      outTradeNo,
      attach,
    });

    return {
      ...params,
      orderId: order.id,
      outTradeNo,
    };
  }

  /**
   * 微信支付充值异步通知入账（原子与幂等）
   */
  async handleRechargeNotify(resource: WechatPaymentNotifyResource) {
    const { outTradeNo, transactionId, amount } = resource;

    const order = await this.prisma.prepayRechargeOrder.findUnique({
      where: { outTradeNo },
      include: {
        account: true,
        tenant: { select: { id: true, userId: true, name: true } },
      },
    });

    if (!order) {
      this.logger.warn(`未找到预付充值订单: outTradeNo=${outTradeNo}`);
      return;
    }

    if (order.status === 'SUCCESS') {
      this.logger.log(`预付充值订单 ${outTradeNo} 已处理，幂等跳过`);
      return;
    }

    const paidAt = resource.successTime ? new Date(resource.successTime) : new Date();

    // 事务内原子入账
    await this.prisma.$transaction(async (tx) => {
      // 1. 分配连续收据号
      const receiptNumber = await this.nextReceiptNumber(tx);

      // 2. 更新订单状态为 SUCCESS
      await tx.prepayRechargeOrder.update({
        where: { id: order.id },
        data: {
          status: 'SUCCESS',
          transactionId,
          paidAt,
          receiptNumber,
          rawResponse: resource as any,
        },
      });

      // 3. 更新预付账户余额
      const updatedAccount = await tx.prepayAccount.update({
        where: { id: order.accountId },
        data: {
          balanceCache: { increment: amount },
        },
      });

      // 4. 插入预付交易流水
      await tx.prepayTransaction.create({
        data: {
          accountId: order.accountId,
          type: 'RECHARGE',
          amount,
          balanceAfter: updatedAccount.balanceCache,
          relatedId: order.id,
          relatedType: 'ONLINE_RECHARGE',
          description: `微信线上充值 (单号: ${outTradeNo})`,
          operatorId: 'SYSTEM_WECHAT_PAY',
          createdAt: paidAt,
        },
      });
    });

    this.logger.log(`预付充值入账成功: 订单=${order.id}, 单号=${outTradeNo}, 金额=${amount}分`);

    // 充值成功通知
    if (order.tenant?.userId) {
      const balanceYuan = ((order.account.balanceCache + amount) / 100).toFixed(2);
      const amountYuan = (amount / 100).toFixed(2);
      await this.notificationsService.create({
        userId: order.tenant.userId,
        title: '预付充值成功',
        body: `您已成功充值 ¥${amountYuan}，当前预付账户可用余额为 ¥${balanceYuan}`,
        priority: 'NORMAL' as any,
        data: {
          type: 'PREPAY_RECHARGE',
          orderId: order.id,
          amount,
          outTradeNo,
        },
      }).catch((err) => {
        this.logger.error(`下发充值成功通知失败: ${err.message}`);
      });
    }
  }

  /**
   * 微信支付主动查单补入账
   */
  async queryAndSyncRechargeOrder(
    dto: PrepayQueryRechargeDto,
    user: { userId: string; role: string; tenantId?: string },
  ) {
    const order = await this.prisma.prepayRechargeOrder.findUnique({
      where: { outTradeNo: dto.outTradeNo },
      include: {
        account: true,
        tenant: { select: { id: true, userId: true, name: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('充值订单不存在');
    }

    if (user.role === 'TENANT') {
      if (user.tenantId && order.tenantId !== user.tenantId) {
        throw new ForbiddenException('您无权查询他人的充值订单');
      }
    }

    if (order.status === 'SUCCESS') {
      return {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        status: order.status,
        amount: order.amount,
        paidAt: order.paidAt,
        receiptNumber: order.receiptNumber,
      };
    }

    // 调微信查单
    if (!this.paymentProvider.queryOrder) {
      throw new BadRequestException('当前支付通道不支持微信查单');
    }

    const queried = await this.paymentProvider.queryOrder(dto.outTradeNo);
    if (!queried) {
      return {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        status: order.status,
        amount: order.amount,
      };
    }

    const isSuccess = queried.status === 'SUCCESS' || queried.tradeState === 'SUCCESS';
    if (isSuccess && (queried.amount ?? order.amount)) {
      await this.handleRechargeNotify({
        outTradeNo: dto.outTradeNo,
        transactionId: queried.transactionId || `mock_tx_${Date.now()}`,
        tradeState: 'SUCCESS',
        amount: queried.amount ?? order.amount,
        openid: queried.openid || '',
        attach: queried.attach,
      });

      const updated = await this.prisma.prepayRechargeOrder.findUniqueOrThrow({
        where: { id: order.id },
      });

      return {
        orderId: updated.id,
        outTradeNo: updated.outTradeNo,
        status: updated.status,
        amount: updated.amount,
        paidAt: updated.paidAt,
        receiptNumber: updated.receiptNumber,
      };
    }

    return {
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      status: queried.tradeState || queried.status || order.status,
      amount: order.amount,
    };
  }

  /**
   * 低余额多渠道预警检测与下发（带每日频控）
   */
  async triggerLowBalanceAlertIfNeeded(accountId: string): Promise<boolean> {
    const account = await this.prisma.prepayAccount.findUnique({
      where: { id: accountId },
      include: { tenant: { select: { id: true, name: true, phone: true, userId: true } } },
    });
    if (!account || !account.tenant?.userId) return false;
    if (account.balanceCache >= account.lowBalanceThreshold) return false;

    // 每日频控：今天已发过则跳过
    const today = this.clock.todayUtc();
    if (account.lastNotifiedAt && account.lastNotifiedAt >= today) {
      return false;
    }

    const userId = account.tenant.userId;
    const balanceYuan = (account.balanceCache / 100).toFixed(2);
    const thresholdYuan = (account.lowBalanceThreshold / 100).toFixed(2);
    const dateStr = this.clock.formatDate();

    await this.notificationsService.create({
      userId,
      title: '预付余额不足提醒',
      body: `您的预付账户余额 ¥${balanceYuan} 已低于提醒阈值 ¥${thresholdYuan}，请及时充值`,
      priority: 'NORMAL' as any,
      data: {
        type: 'PREPAY_LOW_BALANCE',
        prepayAccountId: account.id,
        balance: account.balanceCache,
        threshold: account.lowBalanceThreshold,
        page: '/packageA/bill-detail/bill-detail',
        templateData: {
          thing1: { value: '预付账户余额不足' },
          amount2: { value: `¥${balanceYuan}` },
          time3: { value: dateStr },
          thing4: { value: '请及时充值以免影响水电正常使用' },
        },
      },
      dedupKey: `LOW_BALANCE:${userId}:${account.id}:${dateStr}`,
    }).catch((err) => {
      this.logger.error(`下发低余额提醒失败: ${err.message}`);
    });

    await this.prisma.prepayAccount.update({
      where: { id: account.id },
      data: { lastNotifiedAt: new Date() },
    });

    return true;
  }

  /** 收据号：R{业务日}{6 位序号}；序列由数据库原子分配。 */
  private async nextReceiptNumber(tx: Prisma.TransactionClient): Promise<string | null> {
    const raw = tx as unknown as { $queryRaw: Function };
    if (typeof raw.$queryRaw !== 'function') return null;
    try {
      const rows = await raw.$queryRaw(Prisma.sql`SELECT nextval('payment_receipt_seq') AS nextval`);
      const row = Array.isArray(rows) ? (rows[0] as { nextval?: bigint | number } | undefined) : undefined;
      const sequence = Number(row?.nextval ?? 0);
      if (!sequence) return null;
      return `R${this.clock.formatDate().replace(/-/g, '')}${String(sequence).padStart(6, '0')}`;
    } catch {
      return null;
    }
  }
}
