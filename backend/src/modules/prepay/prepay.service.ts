import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePrepayAccountDto } from './dto/create-prepay-account.dto.js';
import { UpdatePrepayAccountDto } from './dto/update-prepay-account.dto.js';
import { QueryPrepayAccountsDto } from './dto/query-prepay-accounts.dto.js';

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
        include: { tenant: { select: { name: true } } },
      }),
      this.prisma.prepayAccount.count({ where }),
    ]);

    return {
      data,
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
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

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
}
