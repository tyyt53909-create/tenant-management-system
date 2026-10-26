import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthService } from '../auth/jwt.service.js';
import { resolveBcryptRounds } from '../../config/password.config.js';
import {
  STAFF_ROLES,
  type StaffRole,
  CreateStaffDto,
  QueryStaffDto,
  ResetStaffPasswordDto,
  UpdateStaffDto,
  AssignStaffBuildingsDto,
} from './dto/staff.dto.js';

const STAFF_SELECT = {
  id: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  buildingAssignments: {
    select: {
      buildingId: true,
      assignedAt: true,
      building: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
    },
  },
} as const;

export function formatStaffItem<T extends { buildingAssignments?: Array<{ building: any; buildingId: string }> }>(
  item: T,
) {
  const { buildingAssignments, ...rest } = item;
  return {
    ...rest,
    assignedBuildings: buildingAssignments?.map((a) => a.building) ?? [],
    assignedBuildingIds: buildingAssignments?.map((a) => a.buildingId) ?? [],
  };
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtAuthService,
  ) {}

  async list(query: QueryStaffDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.UserWhereInput = {
      role: query.role ? query.role : { in: [...STAFF_ROLES] },
      ...(query.keyword?.trim()
        ? {
            OR: [
              { email: { contains: query.keyword.trim(), mode: 'insensitive' as const } },
              { phone: { contains: query.keyword.trim() } },
            ],
          }
        : {}),
      ...(query.buildingId
        ? {
            buildingAssignments: {
              some: { buildingId: query.buildingId },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: STAFF_SELECT,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map(formatStaffItem),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: STAFF_SELECT,
    });
    if (!user || !STAFF_ROLES.includes(user.role as StaffRole)) {
      throw new NotFoundException('员工不存在');
    }
    return formatStaffItem(user);
  }

  async create(dto: CreateStaffDto, operatorId?: string) {
    if (!STAFF_ROLES.includes(dto.role)) {
      throw new BadRequestException('仅可创建合法员工角色账号');
    }

    const email = dto.email.trim().toLowerCase();
    const phone = dto.phone?.trim() || null;
    const passwordHash = await bcrypt.hash(
      dto.password,
      resolveBcryptRounds(this.config.get<string>('BCRYPT_ROUNDS')),
    );

    if (dto.buildingIds?.length) {
      const validCount = await this.prisma.building.count({
        where: { id: { in: dto.buildingIds } },
      });
      if (validCount !== dto.buildingIds.length) {
        throw new BadRequestException('部分指派楼栋不存在');
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            phone,
            role: dto.role,
            passwordHash,
            isActive: true,
          },
        });

        if (dto.buildingIds?.length) {
          await tx.staffBuildingAssignment.createMany({
            data: dto.buildingIds.map((buildingId) => ({
              userId: user.id,
              buildingId,
              assignedBy: operatorId,
            })),
          });
        }

        return tx.user.findUnique({
          where: { id: user.id },
          select: STAFF_SELECT,
        });
      });

      return formatStaffItem(created!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('邮箱或手机号已被使用');
      throw error;
    }
  }

  async update(id: string, actorId: string, dto: UpdateStaffDto) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: STAFF_SELECT });
    if (!target || !STAFF_ROLES.includes(target.role as StaffRole)) {
      throw new NotFoundException('员工不存在');
    }

    if (id === actorId && dto.isActive === false) {
      throw new BadRequestException('不能停用自己的账号');
    }

    if (dto.role && !STAFF_ROLES.includes(dto.role)) {
      throw new BadRequestException('非法的员工角色');
    }

    if (dto.buildingIds?.length) {
      const validCount = await this.prisma.building.count({
        where: { id: { in: dto.buildingIds } },
      });
      if (validCount !== dto.buildingIds.length) {
        throw new BadRequestException('部分指派楼栋不存在');
      }
    }

    const demotesAdmin =
      target.role === 'ADMIN' &&
      ((dto.role !== undefined && dto.role !== 'ADMIN') || dto.isActive === false);

    const updateData: Prisma.UserUpdateInput = {};
    if (dto.role !== undefined) updateData.role = dto.role as UserRole;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.phone !== undefined) updateData.phone = dto.phone;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (demotesAdmin) {
          await tx.$queryRaw`SELECT id FROM users WHERE role = 'ADMIN' AND "isActive" = true FOR UPDATE`;
          const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', isActive: true } });
          if (target.isActive && activeAdmins <= 1) {
            throw new ForbiddenException('不能停用或降级最后一位有效管理员');
          }
        }

        await tx.user.update({
          where: { id },
          data: updateData,
        });

        if (dto.buildingIds !== undefined) {
          await tx.staffBuildingAssignment.deleteMany({
            where: { userId: id },
          });
          if (dto.buildingIds.length > 0) {
            await tx.staffBuildingAssignment.createMany({
              data: dto.buildingIds.map((buildingId) => ({
                userId: id,
                buildingId,
                assignedBy: actorId,
              })),
            });
          }
        }

        return tx.user.findUnique({
          where: { id },
          select: STAFF_SELECT,
        });
      });

      if (dto.isActive === false) {
        await this.jwt.revokeUserSessions(id);
      }

      return formatStaffItem(updated!);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('手机号已被使用');
      throw error;
    }
  }

  async assignBuildings(id: string, dto: AssignStaffBuildingsDto, operatorId?: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!target || !STAFF_ROLES.includes(target.role as StaffRole)) {
      throw new NotFoundException('员工不存在');
    }

    if (dto.buildingIds.length > 0) {
      const validCount = await this.prisma.building.count({
        where: { id: { in: dto.buildingIds } },
      });
      if (validCount !== dto.buildingIds.length) {
        throw new BadRequestException('部分指派楼栋不存在');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.staffBuildingAssignment.deleteMany({ where: { userId: id } });
      if (dto.buildingIds.length > 0) {
        await tx.staffBuildingAssignment.createMany({
          data: dto.buildingIds.map((buildingId) => ({
            userId: id,
            buildingId,
            assignedBy: operatorId,
          })),
        });
      }
    });

    return this.getAssignedBuildings(id);
  }

  async getAssignedBuildings(id: string) {
    const assignments = await this.prisma.staffBuildingAssignment.findMany({
      where: { userId: id },
      include: {
        building: {
          select: {
            id: true,
            name: true,
            address: true,
            isActive: true,
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return assignments.map((a) => a.building);
  }

  async getMyBuildings(userId: string, role: string) {
    if (role === 'ADMIN') {
      return this.prisma.building.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          address: true,
          isActive: true,
        },
        orderBy: { name: 'asc' },
      });
    }

    const assignments = await this.prisma.staffBuildingAssignment.findMany({
      where: { userId },
      include: {
        building: {
          select: {
            id: true,
            name: true,
            address: true,
            isActive: true,
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return assignments.map((a) => a.building);
  }

  async resetPassword(id: string, dto: ResetStaffPasswordDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });
    if (!existing || !STAFF_ROLES.includes(existing.role as StaffRole)) {
      throw new NotFoundException('员工不存在');
    }

    const passwordHash = await bcrypt.hash(
      dto.newPassword,
      resolveBcryptRounds(this.config.get<string>('BCRYPT_ROUNDS')),
    );
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.jwt.revokeUserSessions(id);
    return { message: '密码已重置' };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
