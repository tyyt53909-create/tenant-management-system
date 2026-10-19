import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { QueryTenantsDto } from './dto/query-tenants.dto.js';

/**
 * 租客对外字段白名单（T148 脱敏）
 *
 * 显式列出可返回字段，避免未来给 Tenant 增加敏感列（证件号、银行卡号等）时被
 * findMany / findUnique 全字段自动带出。证件号位于 TenantRegistration.idNumber
 * （docs/02-数据模型.md：字段级加密、仅管理者可见），本模块任何响应都不得包含。
 */
export const TENANT_PUBLIC_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  emergencyContact: true,
  emergencyPhone: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
} as const;

/** 标签按字典顺序展示（T215） */
const TAG_ORDER_BY: Prisma.TenantTagOrderByWithRelationInput[] = [
  { tag: { sort: 'asc' } },
  { tag: { name: 'asc' } },
];
/** 标签关联行只需要 id 与名称 */
const TENANT_TAG_ROW = { select: { tag: { select: { id: true, name: true } } } };
/** create / update 的 include 形态 */
const TENANT_TAG_INCLUDE = { orderBy: TAG_ORDER_BY, ...TENANT_TAG_ROW };
/** findMany / findUnique 的 select 分支下嵌套标签 */
const TENANT_TAG_SELECT = { orderBy: TAG_ORDER_BY, ...TENANT_TAG_ROW };

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly auditLogService: AuditLogService,
  ) {}

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

    // 3. 校验标签字典 ID（T215）
    const tagIds = await this.assertTagIdsExist(dto.tagIds);

    // 4. 创建租客
    const created = await this.prisma.tenant.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        emergencyContact: dto.emergencyContact,
        emergencyPhone: dto.emergencyPhone,
        notes: dto.notes,
        ...(tagIds.length ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } } : {}),
      },
      include: { tags: TENANT_TAG_INCLUDE },
    });
    return this.flattenTags(created);
  }

  async findAll(query: QueryTenantsDto) {
    const { page = 1, limit = 20, isActive, name, phone, tagId } = query;
    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: Prisma.TenantWhereInput = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // 姓名/手机号模糊查询（大小写不敏感）；空串视为不筛选
    if (name?.trim()) where.name = { contains: name.trim(), mode: 'insensitive' };
    if (phone?.trim()) where.phone = { contains: phone.trim() };
    // 标签筛选（T215）：只要有该标签即可
    if (tagId?.trim()) where.tags = { some: { tagId: tagId.trim() } };

    // 查询数据和总数
    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        // 白名单字段：不返回证件号等敏感信息（T148）
        select: { ...TENANT_PUBLIC_SELECT,
          contracts:{where:{status:'ACTIVE'},orderBy:{startDate:'desc'},take:1,select:{id:true,contractNumber:true,startDate:true,endDate:true,status:true,rentAmount:true,room:{select:{roomNumber:true}}}},
          prepayAccounts:{select:{balanceCache:true}},
          tags: TENANT_TAG_SELECT,
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    const masks = await this.maskedIdNumbers(data.map((tenant) => tenant.id));

    return {
      data: data.map((tenant) => ({
        ...this.flattenTags(tenant),
        idNumberMasked: masks.get(tenant.id) ?? null,
      })),
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
      // 白名单字段 + 账号信息（不含证件号），T148 脱敏
      select: {
        ...TENANT_PUBLIC_SELECT,
        tags: TENANT_TAG_SELECT,
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

    const masks = await this.maskedIdNumbers([tenant.id]);
    return {
      ...this.flattenTags(tenant),
      idNumberMasked: masks.get(tenant.id) ?? null,
    };
  }

  /**
   * 查看证件号明文。只允许管理员调用。审计记录不保存明文。
   */
  async revealIdNumber(
    tenantId: string,
    actor: { userId: string; ip: string; userAgent: string },
  ) {
    const registration = await this.prisma.tenantRegistration.findUnique({
      where: { tenantId },
      select: { id: true, idNumber: true, idType: true },
    });
    if (!registration) {
      throw new NotFoundException('未登记证件号');
    }

    const idNumber = this.crypto.decrypt(registration.idNumber);
    await this.auditLogService.log({
      userId: actor.userId,
      action: 'VIEW_ID_NUMBER',
      entityType: 'TenantRegistration',
      entityId: registration.id,
      changes: { tenantId },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { idNumber, idType: registration.idType };
  }

  /**
   * 租客查看自己的档案（docs/03-权限矩阵.md §3.2：租客仅可查看自己）
   * 非本人（或未绑定租客档案）一律按不存在处理，避免探测他人 ID
   */
  async findOneForTenant(id: string, tenantId?: string) {
    const tenant = await this.findOne(id);

    if (!tenantId || tenant.id !== tenantId) {
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

    // 4. 更新租客；tagIds 未传表示不改动，传 [] 表示清空（T215）
    const { tagIds, ...rest } = dto;
    const data: Prisma.TenantUpdateInput = { ...rest };
    if (tagIds !== undefined) {
      const validTagIds = await this.assertTagIdsExist(tagIds);
      data.tags = { deleteMany: {}, create: validTagIds.map((tagId) => ({ tagId })) };
    }
    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
      include: { tags: TENANT_TAG_INCLUDE },
    });
    return this.flattenTags(updated);
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

  /**
   * 校验标签 ID 全部存在，返回去重后的 ID 列表（T215）。
   * 不存在时 400 而不是静默忽略——静默会让人以为标签已保存。
   */
  private async assertTagIdsExist(tagIds?: string[]): Promise<string[]> {
    if (!tagIds?.length) return [];
    const unique = [...new Set(tagIds)];
    const found = await this.prisma.tag.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const foundIds = new Set(found.map((tag) => tag.id));
      const missing = unique.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`标签不存在：${missing.join(', ')}`);
    }
    return unique;
  }

  /** 把关联行摊平成 { id, name } 列表，响应保持简单（T215） */
  private flattenTags<T extends { tags?: { tag: { id: string; name: string } }[] }>(tenant: T) {
    const { tags, ...rest } = tenant;
    return { ...rest, tags: (tags ?? []).map((row) => row.tag) };
  }

  private async maskedIdNumbers(tenantIds: string[]) {
    const masks = new Map<string, string>();
    if (tenantIds.length === 0) {
      return masks;
    }
    const rows = await this.prisma.tenantRegistration.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { tenantId: true, idNumber: true },
    });
    for (const row of rows) {
      masks.set(row.tenantId, this.crypto.maskStored(row.idNumber));
    }
    return masks;
  }
}
