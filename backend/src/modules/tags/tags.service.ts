import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueConstraintError } from '../../common/utils/prisma-error.js';
import { CreateTagDto } from './dto/create-tag.dto.js';
import { UpdateTagDto } from './dto/update-tag.dto.js';

/**
 * 租客标签字典（T215，docs/00 §2.1 P0「标签管理」）。
 *
 * 字典由管理者维护，租客只能被赋予字典里的标签；这样列表筛选、统计口径才成立。
 * 删除标签会连带删除 TenantTag 关联行（onDelete: Cascade），不影响租客本身。
 */
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 全部标签，附带使用人数，便于管理者判断能否删除 */
  findAll() {
    return this.prisma.tag.findMany({
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        sort: true,
        createdAt: true,
        _count: { select: { tenants: true } },
      },
    }).then((tags) => tags.map(({ _count, ...tag }) => ({ ...tag, tenantCount: _count.tenants })));
  }

  async create(dto: CreateTagDto) {
    const name = dto.name.trim();
    try {
      return await this.prisma.tag.create({
        data: { name, sort: dto.sort ?? (await this.nextSort()) },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('标签名称已存在');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTagDto) {
    await this.ensureExists(id);
    const data: { name?: string; sort?: number } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.sort !== undefined) data.sort = dto.sort;
    try {
      return await this.prisma.tag.update({ where: { id }, data });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('标签名称已存在');
      }
      throw error;
    }
  }

  /** 删除标签；已分配给租客时一并解除关联（Cascade），返回受影响租客数 */
  async remove(id: string) {
    await this.ensureExists(id);
    const { _count } = await this.prisma.tag.delete({
      where: { id },
      select: { _count: { select: { tenants: true } } },
    });
    return { message: '标签已删除', affectedTenants: _count.tenants };
  }

  private async ensureExists(id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id }, select: { id: true } });
    if (!tag) {
      throw new NotFoundException('标签不存在');
    }
  }

  /** 未指定顺序时排到最后，避免新标签插到既有排序中间 */
  private async nextSort(): Promise<number> {
    const last = await this.prisma.tag.findFirst({
      orderBy: { sort: 'desc' },
      select: { sort: true },
    });
    return (last?.sort ?? 0) + 10;
  }
}
