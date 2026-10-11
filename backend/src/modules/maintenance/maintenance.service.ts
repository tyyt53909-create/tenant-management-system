import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto.js';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto.js';
import { QueryMaintenanceDto } from './dto/query-maintenance.dto.js';

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMaintenanceDto) {
    // 验证房源和租客存在
    const [room, tenant] = await Promise.all([
      this.prisma.room.findUnique({ where: { id: dto.roomId } }),
      this.prisma.tenant.findUnique({ where: { id: dto.tenantId } }),
    ]);

    if (!room) throw new BadRequestException('房源不存在');
    if (!tenant) throw new BadRequestException('租客不存在');

    return this.prisma.maintenanceRequest.create({
      data: {
        roomId: dto.roomId,
        tenantId: dto.tenantId,
        title: dto.title,
        description: dto.description,
        category: dto.category as any,
        priority: dto.priority as any || 'NORMAL',
      },
    });
  }

  async findAll(query: QueryMaintenanceDto) {
    const { page = 1, limit = 20, status, roomId, tenantId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (tenantId) where.tenantId = tenantId;

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { roomNumber: true } },
          tenant: { select: { name: true } },
        },
      }),
      this.prisma.maintenanceRequest.count({ where }),
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
    const request = await this.prisma.maintenanceRequest.findUnique({
      where: { id },
      include: {
        room: true,
        tenant: true,
        photos: true,
      },
    });

    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    return request;
  }

  async update(id: string, dto: UpdateMaintenanceDto) {
    const request = await this.prisma.maintenanceRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    const updateData: any = {};
    if (dto.status) updateData.status = dto.status;
    if (dto.assignedTo) {
      updateData.assignedTo = dto.assignedTo;
      updateData.assignedAt = new Date();
    }
    if (dto.resolution) {
      updateData.resolution = dto.resolution;
      updateData.resolvedAt = new Date();
    }

    return this.prisma.maintenanceRequest.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    const request = await this.prisma.maintenanceRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('报修记录不存在');
    }

    await this.prisma.maintenanceRequest.delete({ where: { id } });
    return { message: '报修记录已删除' };
  }
}
