import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { QueryTenantsDto } from './dto/query-tenants.dto.js';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTenantDto) {
    // 1. 检查手机号唯一性
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { phone: dto.phone },
    });

    if (existingTenant) {
      throw new ConflictException('手机号已被使用');
    }

    // 2. 检查邮箱唯一性（如果提供）
    if (dto.email) {
      const existingEmail = await this.prisma.tenant.findUnique({
        where: { email: dto.email },
      });

      if (existingEmail) {
        throw new ConflictException('邮箱已被使用');
      }
    }

    // 3. 创建租客
    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        emergencyContact: dto.emergencyContact,
        emergencyPhone: dto.emergencyPhone,
        tags: dto.tags,
        notes: dto.notes,
      },
    });
  }

  async findAll(query: QueryTenantsDto) {
    const { page = 1, limit = 20, isActive } = query;
    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: any = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // 查询数据和总数
    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.tenant.count({ where }),
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
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    // 1. 检查租客是否存在
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    // 2. 检查手机号唯一性（如果修改）
    if (dto.phone && dto.phone !== tenant.phone) {
      const existingPhone = await this.prisma.tenant.findUnique({
        where: { phone: dto.phone },
      });

      if (existingPhone) {
        throw new ConflictException('手机号已被使用');
      }
    }

    // 3. 检查邮箱唯一性（如果修改）
    if (dto.email && dto.email !== tenant.email) {
      const existingEmail = await this.prisma.tenant.findUnique({
        where: { email: dto.email },
      });

      if (existingEmail) {
        throw new ConflictException('邮箱已被使用');
      }
    }

    // 4. 更新租客
    return this.prisma.tenant.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    // 1. 检查租客是否存在
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    // 2. 硬删除
    await this.prisma.tenant.delete({
      where: { id },
    });

    return { message: '租客已删除' };
  }
}
