import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthService } from '../auth/jwt.service.js';
import { resolveBcryptRounds } from '../../config/password.config.js';
import { CreateStaffDto, QueryStaffDto, ResetStaffPasswordDto, UpdateStaffDto } from './dto/staff.dto.js';

const STAFF_SELECT = { id: true, email: true, phone: true, role: true, isActive: true, createdAt: true } as const;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly jwt: JwtAuthService) {}

  async list(query: QueryStaffDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: Prisma.UserWhereInput = {
      role: query.role ? query.role : { in: ['ADMIN', 'CLEANER'] },
      ...(query.keyword?.trim() ? { OR: [
        { email: { contains: query.keyword.trim(), mode: 'insensitive' as const } },
        { phone: { contains: query.keyword.trim() } },
      ] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: STAFF_SELECT, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async create(dto: CreateStaffDto) {
    if (dto.role !== 'ADMIN' && dto.role !== 'CLEANER') throw new BadRequestException('仅可创建管理员或保洁账号');
    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim() || null;
    const passwordHash = await bcrypt.hash(dto.password, resolveBcryptRounds(this.config.get<string>('BCRYPT_ROUNDS')));
    try {
      return await this.prisma.user.create({ data: { email, phone, role: dto.role, passwordHash, isActive: true }, select: STAFF_SELECT });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('邮箱或手机号已被使用');
      throw error;
    }
  }

  async update(id: string, actorId: string, dto: UpdateStaffDto) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: STAFF_SELECT });
    if (!target || !['ADMIN', 'CLEANER'].includes(target.role)) throw new NotFoundException('员工不存在');
    if (id === actorId && dto.isActive === false) throw new BadRequestException('不能停用自己的账号');
    const demotesAdmin = target.role === 'ADMIN' && (dto.role !== undefined && dto.role !== 'ADMIN' || dto.isActive === false);
    if (demotesAdmin) {
      return this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE role = 'ADMIN' AND "isActive" = true FOR UPDATE`;
        const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true } });
        if (target.isActive && activeAdmins <= 1) throw new ForbiddenException('不能停用或降級最後一位有效管理員');
        const updated = await tx.user.update({ where: { id }, data: dto, select: STAFF_SELECT });
        if (dto.isActive === false) await this.jwt.revokeUserSessions(id);
        return updated;
      });
    }
    try {
      const updated = await this.prisma.user.update({ where: { id }, data: dto, select: STAFF_SELECT });
      if (dto.isActive === false) await this.jwt.revokeUserSessions(id);
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('手机号已被使用');
      throw error;
    }
  }

  async resetPassword(id: string, dto: ResetStaffPasswordDto) {
    const existing = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!existing || !['ADMIN', 'CLEANER'].includes(existing.role)) throw new NotFoundException('员工不存在');
    const passwordHash = await bcrypt.hash(dto.newPassword, resolveBcryptRounds(this.config.get<string>('BCRYPT_ROUNDS')));
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.jwt.revokeUserSessions(id);
    return { message: '密码已重置' };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
