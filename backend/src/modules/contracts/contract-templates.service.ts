import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma, ContractTemplateStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateContractTemplateDto,
  UpdateContractTemplateDto,
  QueryContractTemplatesDto,
} from './dto/contract-template.dto.js';

export const DEFAULT_TEMPLATE_CONTENT = `房屋租赁合同

出租方（甲方）：{buildingName} 物业服务中心
承租方（乙方）：{tenantName}（联系电话：{tenantPhone}）
共同承租人：{coTenantsText}

第一条 租赁房屋坐落及用途
甲方同意将坐落于 {buildingAddress} {buildingName} {roomNumber}室（户型：{roomType}，建筑面积：{roomArea} ㎡）出租给乙方用于居住使用。

第二条 租赁期限
租赁期自 {startDate} 起至 {endDate} 止。

第三条 租金、押金及支付方式
1. 租金标准为人民币：{rentAmountChinese}（小写：¥{rentAmountYuan} 元/月）。
2. 押金金额为人民币：{depositAmountChinese}（小写：¥{depositAmountYuan} 元）。
3. 支付周期为：{paymentCycleText}，乙方应于每月 {paymentDay} 日前结清应付账单。

第四条 双方权利与义务
1. 甲方应按期交付符合安全使用标准的房屋及附属设施。
2. 乙方应合理使用房屋，遵守物业管理规定与消防安全守则。
3. 合同双方已对房屋交付状况进行核验并确认无误。`;

@Injectable()
export class ContractTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 确保系统默认模板存在 */
  async ensureDefaultTemplate() {
    const existing = await this.prisma.contractTemplate.findFirst({
      where: { code: 'STANDARD_RESIDENTIAL' },
    });
    if (!existing) {
      return this.prisma.contractTemplate.create({
        data: {
          name: '标准住宅租赁合同模板',
          code: 'STANDARD_RESIDENTIAL',
          description: '适用于普通住宅、公寓租赁场景的规范合同文本',
          content: DEFAULT_TEMPLATE_CONTENT,
          terms: { rules: ['禁止擅自转租', '保持房屋结构完整', '按时缴纳租金与水电'] },
          isDefault: true,
          status: 'ACTIVE',
          createdBy: 'system',
        },
      });
    }
    return existing;
  }

  async findAll(query: QueryContractTemplatesDto) {
    await this.ensureDefaultTemplate();
    const { page = 1, limit = 20, status, keyword } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ContractTemplateWhereInput = {};
    if (status) where.status = status;
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { code: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.contractTemplate.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.contractTemplate.count({ where }),
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

  async findDefault() {
    await this.ensureDefaultTemplate();
    const defaultTemplate = await this.prisma.contractTemplate.findFirst({
      where: { isDefault: true, status: 'ACTIVE' },
    });
    return defaultTemplate || (await this.ensureDefaultTemplate());
  }

  async findOne(id: string) {
    const template = await this.prisma.contractTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('合同模板不存在');
    }
    return template;
  }

  async create(dto: CreateContractTemplateDto, operatorId: string) {
    const existing = await this.prisma.contractTemplate.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`模板编码 ${dto.code} 已存在`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.contractTemplate.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.contractTemplate.create({
        data: {
          name: dto.name,
          code: dto.code,
          description: dto.description,
          content: dto.content,
          terms: dto.terms as Prisma.InputJsonValue,
          isDefault: dto.isDefault ?? false,
          status: dto.status ?? 'ACTIVE',
          createdBy: operatorId,
        },
      });
    });
  }

  async update(id: string, dto: UpdateContractTemplateDto) {
    const template = await this.findOne(id);

    if (dto.code && dto.code !== template.code) {
      const existing = await this.prisma.contractTemplate.findUnique({
        where: { code: dto.code },
      });
      if (existing) {
        throw new ConflictException(`模板编码 ${dto.code} 已存在`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.contractTemplate.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      return tx.contractTemplate.update({
        where: { id },
        data: {
          name: dto.name,
          code: dto.code,
          description: dto.description,
          content: dto.content,
          terms: dto.terms !== undefined ? (dto.terms as Prisma.InputJsonValue) : undefined,
          isDefault: dto.isDefault,
          status: dto.status,
        },
      });
    });
  }

  async remove(id: string) {
    const template = await this.findOne(id);
    if (template.isDefault) {
      throw new ConflictException('系统默认合同模板不可删除');
    }

    const boundContracts = await this.prisma.contract.count({
      where: { templateId: id },
    });
    if (boundContracts > 0) {
      throw new ConflictException('已有合同关联该模板，不能删除，可停用状态');
    }

    await this.prisma.contractTemplate.delete({ where: { id } });
    return { success: true, message: '合同模板已删除' };
  }

  /** 渲染模板变量 */
  render(content: string, variables: Record<string, string | number | null | undefined>): string {
    let result = content;
    for (const [key, val] of Object.entries(variables)) {
      const displayVal = val === null || val === undefined ? '' : String(val);
      result = result.replaceAll(`{${key}}`, displayVal);
    }
    return result;
  }
}
