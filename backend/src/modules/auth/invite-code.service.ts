import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { apiError, ErrorCode } from '../../common/errors/error-codes.js';
import type { Prisma, UserRole, InviteCodeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomHex } from '../../common/utils/secure-random.js';
import { QueryInviteCodesDto } from './dto/query-invite-codes.dto.js';

export interface ValidatedInviteCode {
  valid: boolean;
  invitedBy?: string;
  inviteCodeId?: string;
  role?: UserRole;
  reason?: string;
}

@Injectable()
export class InviteCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成单个邀请码（管理员专用）
   */
  async generateInviteCode(
    adminUserId: string,
    expiryDays: number = 365,
    notes?: string,
    role: UserRole = 'TENANT',
  ): Promise<string> {
    const inviteCode = `INVITE-${Date.now()}-${randomHex(3)}`;
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    await this.prisma.inviteCode.create({
      data: {
        code: inviteCode,
        role,
        status: 'UNUSED',
        notes: notes ?? null,
        creatorId: adminUserId,
        expiresAt,
      },
    });

    return inviteCode;
  }

  /**
   * 批量生成独立邀请码（一次性生成 N 个独立记录，每个码独立核销）
   */
  async generateBatchInviteCodes(
    adminUserId: string,
    count: number,
    expiryDays: number = 365,
    notes?: string,
    role: UserRole = 'TENANT',
  ): Promise<string[]> {
    const safeCount = Math.min(Math.max(1, count), 100);
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const codes: string[] = [];
    const data: Prisma.InviteCodeCreateManyInput[] = [];

    const now = Date.now();
    for (let i = 0; i < safeCount; i++) {
      const code = `INVITE-${now}-${i + 1}-${randomHex(3)}`;
      codes.push(code);
      data.push({
        code,
        role,
        status: 'UNUSED',
        notes: notes ?? null,
        creatorId: adminUserId,
        expiresAt,
      });
    }

    await this.prisma.inviteCode.createMany({
      data,
    });

    return codes;
  }

  /**
   * 验证邀请码（注册或延迟绑定时使用）
   */
  async validateInviteCode(code: string): Promise<ValidatedInviteCode> {
    if (!code || typeof code !== 'string') {
      return { valid: false, reason: 'INVALID_CODE' };
    }

    const trimmedCode = code.trim();
    const record = await this.prisma.inviteCode.findUnique({
      where: { code: trimmedCode },
      select: {
        id: true,
        code: true,
        status: true,
        role: true,
        expiresAt: true,
        creatorId: true,
      },
    });

    if (!record) {
      return { valid: false, reason: 'NOT_FOUND' };
    }

    if (record.status === 'REVOKED') {
      throw new BadRequestException('邀请码已被作废');
    }

    if (record.status === 'USED') {
      return { valid: false, reason: 'ALREADY_USED' };
    }

    if (record.expiresAt && new Date() > record.expiresAt) {
      throw new BadRequestException('邀请码已过期');
    }

    return {
      valid: true,
      invitedBy: record.creatorId ?? undefined,
      inviteCodeId: record.id,
      role: record.role,
    };
  }

  /**
   * 核销邀请码（原子标记为已使用，记录使用者与使用时间）
   */
  async consumeInviteCode(
    code: string,
    usedById: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    if (!db.inviteCode) {
      throw apiError(ErrorCode.COMMON_INTERNAL_ERROR, '邀请码存储不可用，已拒绝核销');
    }
    const result = await db.inviteCode.updateMany({
      where: {
        code: code.trim(),
        status: 'UNUSED',
        expiresAt: { gt: new Date() },
      },
      data: {
        status: 'USED',
        usedById,
        usedAt: new Date(),
      },
    });
    // 并发核销时只有一个请求能把 UNUSED 改成 USED，其余必须整体回滚（T260）。
    if (result.count === 0) {
      throw apiError(ErrorCode.AUTH_INVITE_CODE_CONFLICT);
    }
  }

  /**
   * 检查管理员是否有活跃未过期的邀请码
   */
  async hasValidInviteCode(userId: string): Promise<boolean> {
    const count = await this.prisma.inviteCode.count({
      where: {
        creatorId: userId,
        status: 'UNUSED',
        expiresAt: { gt: new Date() },
      },
    });
    return count > 0;
  }

  /**
   * 管理员查询邀请码列表（支持分页、状态筛选、模糊搜索）
   */
  async findAll(query: QueryInviteCodesDto) {
    const { page = 1, limit = 20, status, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.InviteCodeWhereInput = {};
    if (status) {
      where.status = status;
    }
    if (search && search.trim()) {
      const trimmed = search.trim();
      where.OR = [
        { code: { contains: trimmed, mode: 'insensitive' } },
        { notes: { contains: trimmed, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.inviteCode.count({ where }),
      this.prisma.inviteCode.findMany({
        where,
        include: {
          creator: { select: { id: true, email: true, phone: true } },
          usedBy: { select: { id: true, email: true, phone: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 管理员作废邀请码
   */
  async revokeInviteCode(id: string, _adminUserId?: string) {
    const inviteCode = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!inviteCode) {
      throw new NotFoundException('邀请码不存在');
    }
    if (inviteCode.status === 'USED') {
      throw new BadRequestException('已使用的邀请码无法作废');
    }
    if (inviteCode.status === 'REVOKED') {
      return inviteCode;
    }

    return this.prisma.inviteCode.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
  }
}
