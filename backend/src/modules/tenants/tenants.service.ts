import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import type { IdType, Prisma, RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { QueryTenantsDto } from './dto/query-tenants.dto.js';
import { UpsertTenantRegistrationDto } from './dto/upsert-tenant-registration.dto.js';
import { assertRegistrationTransition } from './tenant-registration.js';
import { normalizeEmail } from '../../common/utils/normalize-contact.js';

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

    // 2. 检查邮箱唯一性（如果提供）。入库前小写，并用不区分大小写的查询挡住存量混合大小写。
    const email = normalizeEmail(dto.email);
    if (email) {
      const existingEmail = await this.findTenantByEmail(email);
      if (existingEmail) {
        throw new ConflictException('邮箱已被使用');
      }
    }

    // 3. 证件类型与号码必须成对；hash 查重（SEC-08 / T271）
    this.assertIdPair(dto.idType, dto.idNumber);
    const encryptedIdNumber = dto.idNumber ? this.crypto.encrypt(dto.idNumber) : null;
    const idNumberHash = dto.idNumber ? this.crypto.hashIdNumber(dto.idNumber) : null;
    if (idNumberHash) await this.assertIdNumberAvailable(idNumberHash);

    // 4. 校验标签字典 ID（T215）
    const tagIds = await this.assertTagIdsExist(dto.tagIds);

    // 5. 创建租客与登记（同一事务）
    const created = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          phone: dto.phone,
          email,
          emergencyContact: dto.emergencyContact,
          emergencyPhone: dto.emergencyPhone,
          notes: dto.notes,
          ...(tagIds.length ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } } : {}),
        },
        include: { tags: TENANT_TAG_INCLUDE },
      });

      if (encryptedIdNumber && idNumberHash && dto.idType) {
        await tx.tenantRegistration.create({
          data: {
            tenantId: tenant.id,
            idType: dto.idType,
            idNumber: encryptedIdNumber,
            idNumberHash,
            status: 'NOT_REGISTERED',
          },
        });
      }

      return tenant;
    });

    return {
      ...this.flattenTags(created),
      idNumberMasked: encryptedIdNumber ? this.crypto.maskStored(encryptedIdNumber) : null,
    };
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

  /** 按规范化邮箱查找租客。excludeId 用于更新时排除自己。 */
  private findTenantByEmail(email: string, excludeId?: string) {
    return this.prisma.tenant.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
  }

  async update(
    id: string,
    dto: UpdateTenantDto,
    actor?: { userId: string; ip: string; userAgent: string },
  ) {
    // 1. 检查租客是否存在
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('租客不存在');
    }

    const registration = await this.prisma.tenantRegistration.findUnique({ where: { tenantId: id } });
    this.assertIdPair(dto.idType, dto.idNumber, registration?.idType);
    let encryptedIdNumber: string | null = null;
    let idNumberHash: string | null = null;
    if (dto.idNumber) {
      idNumberHash = this.crypto.hashIdNumber(dto.idNumber);
      await this.assertIdNumberAvailable(idNumberHash, id);
      encryptedIdNumber = this.crypto.encrypt(dto.idNumber);
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

    // 3. 检查邮箱唯一性（如果修改）。比较和入库都走规范化后的邮箱。
    const email = dto.email === undefined ? undefined : (normalizeEmail(dto.email) ?? null);
    if (email && email !== tenant.email?.toLowerCase()) {
      const existingEmail = await this.findTenantByEmail(email, id);
      if (existingEmail) {
        throw new ConflictException('邮箱已被使用');
      }
    }

    // 4. 更新租客；tagIds 未传表示不改动，传 [] 表示清空（T215）
    // idType/idNumber 属于登记表，不能透传给 tenant.update（SEC-08 / T271）
    const { tagIds, idType: _idType, idNumber: _idNumber, email: rawEmail, ...rest } = dto;
    void rawEmail;
    const data: Prisma.TenantUpdateInput = {
      ...rest,
      ...(email !== undefined ? { email } : {}),
    };
    if (tagIds !== undefined) {
      const validTagIds = await this.assertTagIdsExist(tagIds);
      data.tags = { deleteMany: {}, create: validTagIds.map((tagId) => ({ tagId })) };
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tenant.update({
        where: { id },
        data,
        include: { tags: TENANT_TAG_INCLUDE },
      });

      if (encryptedIdNumber && idNumberHash) {
        const idType = (dto.idType ?? registration?.idType) as IdType;
        await tx.tenantRegistration.upsert({
          where: { tenantId: id },
          create: {
            tenantId: id,
            idType,
            idNumber: encryptedIdNumber,
            idNumberHash,
            status: 'NOT_REGISTERED',
          },
          update: { idType, idNumber: encryptedIdNumber, idNumberHash },
        });
      } else if (dto.idType && registration) {
        await tx.tenantRegistration.update({ where: { tenantId: id }, data: { idType: dto.idType } });
      }

      return row;
    });

    if (actor && (dto.idNumber || dto.idType)) {
      await this.auditLogService.log({
        userId: actor.userId,
        action: 'UPDATE_TENANT_REGISTRATION',
        entityType: 'TenantRegistration',
        entityId: id,
        changes: {
          tenantId: id,
          idType: dto.idType ?? registration?.idType ?? null,
          status: registration?.status ?? 'NOT_REGISTERED',
          changedFields: [dto.idNumber ? 'idNumber' : null, dto.idType ? 'idType' : null].filter(Boolean),
        },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }

    return {
      ...this.flattenTags(updated),
      idNumberMasked: encryptedIdNumber
        ? this.crypto.maskStored(encryptedIdNumber)
        : (await this.maskedIdNumbers([id])).get(id) ?? null,
    };
  }

  /** 读取居住登记（只返回脱敏证件号）。 */
  async getRegistration(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('租客不存在');
    const registration = await this.prisma.tenantRegistration.findUnique({ where: { tenantId } });
    if (!registration) throw new NotFoundException('该租客尚未登记证件信息');
    return this.registrationView(registration);
  }

  /**
   * 写入/更新居住登记（SEC-08 / T271）。
   * 只改状态或备注时不要求 idNumber；首次登记必须带证件号。
   */
  async upsertRegistration(
    tenantId: string,
    dto: UpsertTenantRegistrationDto,
    actor: { userId: string; ip: string; userAgent: string },
  ) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('租客不存在');

    const existing = await this.prisma.tenantRegistration.findUnique({ where: { tenantId } });
    if (!existing && !dto.idNumber) {
      throw new BadRequestException('首次登记必须提供证件号');
    }
    if (existing && dto.status) {
      assertRegistrationTransition(existing.status, dto.status);
    }

    let encryptedIdNumber: string | null = null;
    let idNumberHash: string | null = null;
    if (dto.idNumber) {
      idNumberHash = this.crypto.hashIdNumber(dto.idNumber);
      await this.assertIdNumberAvailable(idNumberHash, tenantId);
      encryptedIdNumber = this.crypto.encrypt(dto.idNumber);
    }

    const status: RegistrationStatus = dto.status ?? existing?.status ?? 'NOT_REGISTERED';
    const registeredAt =
      status === 'REGISTERED' ? (existing?.registeredAt ?? new Date()) : null;

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.tenantRegistration.update({
            where: { tenantId },
            data: {
              idType: dto.idType,
              ...(encryptedIdNumber && idNumberHash
                ? { idNumber: encryptedIdNumber, idNumberHash }
                : {}),
              status,
              registeredAt,
              ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
            },
          })
        : await tx.tenantRegistration.create({
            data: {
              tenantId,
              idType: dto.idType,
              idNumber: encryptedIdNumber as string,
              idNumberHash,
              status,
              registeredAt,
              notes: dto.notes ?? null,
            },
          });

      await tx.auditLog.create({
        data: {
          userId: actor.userId || null,
          action: 'UPDATE_TENANT_REGISTRATION',
          entityType: 'TenantRegistration',
          entityId: row.id,
          changes: {
            tenantId,
            idType: dto.idType,
            status,
            changedFields: [
              dto.idNumber ? 'idNumber' : null,
              dto.status ? 'status' : null,
              dto.notes !== undefined ? 'notes' : null,
            ].filter(Boolean),
          } as never,
          ip: actor.ip || 'unknown',
          userAgent: actor.userAgent || 'unknown',
        },
      });

      return row;
    });

    return this.registrationView(saved);
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

  private assertIdPair(idType?: IdType, idNumber?: string, existingIdType?: IdType): void {
    if (idNumber && !idType && !existingIdType) {
      throw new BadRequestException('提供证件号时必须同时提供证件类型');
    }
    if (idType && !idNumber && !existingIdType) {
      throw new BadRequestException('提供证件类型时必须同时提供证件号');
    }
  }

  private async assertIdNumberAvailable(hash: string, excludeTenantId?: string): Promise<void> {
    const existing = await this.prisma.tenantRegistration.findUnique({ where: { idNumberHash: hash } });
    if (existing && existing.tenantId !== excludeTenantId) {
      throw new ConflictException('该证件号已登记在其它租客名下');
    }
  }

  private registrationView(registration: {
    tenantId: string;
    idType: IdType;
    idNumber: string;
    status: RegistrationStatus;
    registeredAt: Date | null;
    notes: string | null;
  }) {
    return {
      tenantId: registration.tenantId,
      idType: registration.idType,
      idNumberMasked: this.crypto.maskStored(registration.idNumber),
      status: registration.status,
      registeredAt: registration.registeredAt,
      notes: registration.notes,
    };
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
