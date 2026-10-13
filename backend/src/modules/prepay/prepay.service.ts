import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePrepayAccountDto } from './dto/create-prepay-account.dto.js';
import { UpdatePrepayAccountDto } from './dto/update-prepay-account.dto.js';
import { QueryPrepayAccountsDto } from './dto/query-prepay-accounts.dto.js';
import { CreatePrepayTransactionDto } from './dto/create-prepay-transaction.dto.js';
import { QueryPrepayTransactionsDto } from './dto/query-prepay-transactions.dto.js';

@Injectable()
export class PrepayService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePrepayAccountDto) {
    // 验证租客存在
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new BadRequestException('租客不存在');

    // 检查唯一性
    const existing = await this.prisma.prepayAccount.findUnique({
      where: { tenantId_roomId: { tenantId: dto.tenantId, roomId: dto.roomId } },
    });
    if (existing) throw new ConflictException('该租客的预付账户已存在');

    return this.prisma.prepayAccount.create({
      data: {
        tenantId: dto.tenantId,
        roomId: dto.roomId,
        lowBalanceThreshold: dto.lowBalanceThreshold || 10000,
      },
    });
  }

  async findAll(query: QueryPrepayAccountsDto) {
    const { page = 1, limit = 20, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
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

    const updateData: any = {};
    if (dto.lowBalanceThreshold !== undefined) updateData.lowBalanceThreshold = dto.lowBalanceThreshold;

    return this.prisma.prepayAccount.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const account = await this.prisma.prepayAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('预付账户不存在');
    await this.prisma.prepayAccount.delete({ where: { id } });
    return { message: '预付账户已删除' };
  }

  // 租客查看自己的账户
  async findByTenant(tenantId: string) {
    // 防御：tenantId 缺失时按不存在处理，绝不退化为「取第一个账户」
    if (!tenantId) {
      throw new NotFoundException('预付账户不存在');
    }

    const account = await this.prisma.prepayAccount.findFirst({
      where: { tenantId },
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
  async findTransactionsByTenant(tenantId: string, query: any) {
    const { page = 1, limit = 20 } = query ?? {};
    const skip = (page - 1) * limit;

    // 防御：tenantId 缺失时返回空列表（此前会因 findFirst 拿到任意账户而越权）
    if (!tenantId) {
      return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    }

    // 先获取租客的账户
    const account = await this.prisma.prepayAccount.findFirst({
      where: { tenantId },
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
  async findAllTransactions(query: any) {
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
          throw new BadRequestException('余额不足，无法扣费/退款');
        }

        updated = await tx.prepayAccount.findUniqueOrThrow({ where: { id: accountId } });
      }

      const transaction = await tx.prepayTransaction.create({
        data: {
          accountId,
          type: dto.type as any,
          amount: signedAmount,
          balanceAfter: updated.balanceCache,
          relatedId: dto.relatedId,
          relatedType: dto.relatedType as any,
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
}
