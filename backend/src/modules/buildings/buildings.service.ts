import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateBuildingDto } from './dto/create-building.dto.js';
import { UpdateBuildingDto } from './dto/update-building.dto.js';
import { QueryBuildingsDto } from './dto/query-buildings.dto.js';

@Injectable()
export class BuildingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBuildingDto) {
    const { totalFloors, ...rest } = dto;
    const data: Prisma.BuildingCreateInput = {
      ...rest,
      metadata: rest.metadata ? (rest.metadata as Prisma.InputJsonValue) : undefined,
      floors: rest.floors ?? totalFloors ?? 1,
    };
    return this.prisma.building.create({
      data,
    });
  }

  async findAll(query: QueryBuildingsDto) {
    const { page = 1, limit = 20, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.BuildingWhereInput = {};
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.building.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.building.count({ where }),
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
    const building = await this.prisma.building.findUnique({
      where: { id },
      include: {
        rooms: { take: 10 },
        _count: {
          select: { rooms: true, publicAreas: true },
        },
      },
    });

    if (!building) {
      throw new NotFoundException('楼栋不存在');
    }

    return building;
  }

  async update(id: string, dto: UpdateBuildingDto) {
    const building = await this.prisma.building.findUnique({
      where: { id },
    });

    if (!building) {
      throw new NotFoundException('楼栋不存在');
    }

    const { totalFloors, metadata, ...rest } = dto;
    const data: Prisma.BuildingUpdateInput = {
      ...rest,
      ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      ...(totalFloors !== undefined && rest.floors === undefined ? { floors: totalFloors } : {}),
    };

    return this.prisma.building.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const building = await this.prisma.building.findUnique({
      where: { id },
    });

    if (!building) {
      throw new NotFoundException('楼栋不存在');
    }

    await this.prisma.building.delete({
      where: { id },
    });

    return { message: '楼栋已删除' };
  }
}
