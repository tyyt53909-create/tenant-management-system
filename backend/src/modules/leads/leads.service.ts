import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryLeadsDto } from './dto/query-leads.dto.js';
import { UpdateLeadDto } from './dto/update-lead.dto.js';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryLeadsDto) {
    const { page = 1, limit = 20, status, source, phone, keyword } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (phone) where.phone = { contains: phone };

    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { phone: { contains: keyword } },
        { notes: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: {
            select: {
              id: true,
              roomNumber: true,
              floor: true,
              roomType: true,
              building: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.lead.count({ where }),
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
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        room: {
          select: {
            id: true,
            roomNumber: true,
            floor: true,
            roomType: true,
            building: { select: { id: true, name: true, address: true } },
          },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('意向线索不存在');
    }

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto, operatorId: string) {
    await this.findOne(id);

    return this.prisma.lead.update({
      where: { id },
      data: {
        status: dto.status,
        notes: dto.notes,
        followUpBy: dto.followUpBy || operatorId,
        lastFollowedAt: new Date(),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.lead.delete({ where: { id } });
    return { success: true, message: '线索记录已移除' };
  }
}
