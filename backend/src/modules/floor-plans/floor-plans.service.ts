import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SaveFloorPlanDto } from './dto/save-floor-plan.dto.js';

@Injectable()
export class FloorPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBuilding(buildingId: string) {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId }, select: { id: true } });
    if (!building) throw new NotFoundException('楼栋不存在');
  }

  async findAll(buildingId: string) {
    await this.assertBuilding(buildingId);
    return this.prisma.floorPlan.findMany({ where: { buildingId }, include: { shapes: true }, orderBy: { floor: 'asc' } });
  }

  async save(buildingId: string, floor: number, dto: SaveFloorPlanDto) {
    await this.assertBuilding(buildingId);
    const roomIds = dto.shapes.flatMap(({ roomId }) => roomId ? [roomId] : []);
    if (new Set(roomIds).size !== roomIds.length) throw new ConflictException('同一平面图内房间不可重复绑定');
    if (roomIds.length) {
      const rooms = await this.prisma.room.findMany({ where: { id: { in: roomIds }, buildingId, floor }, select: { id: true } });
      if (rooms.length !== roomIds.length) throw new ConflictException('绑定的房间不存在或不属于该楼层');
      const alreadyBound = await this.prisma.roomShape.findMany({ where: { roomId: { in: roomIds }, floorPlan: { NOT: { buildingId, floor } } }, select: { roomId: true } });
      if (alreadyBound.length) throw new ConflictException('房间已绑定到其他平面图');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.floorPlan.findUnique({ where: { buildingId_floor: { buildingId, floor } } });
        if (!current) {
          if (dto.version !== 0) throw new ConflictException('平面图版本已变更，请刷新后重试');
          return tx.floorPlan.create({ data: { buildingId, floor, width: dto.width, depth: dto.depth, backgroundUrl: dto.backgroundUrl, version: 1, shapes: { create: dto.shapes.map((shape) => ({ roomId: shape.roomId, kind: shape.kind, x: shape.x, y: shape.y, width: shape.width, depth: shape.depth, rotation: shape.rotation, polygon: shape.polygon as Prisma.InputJsonValue | undefined })) } }, include: { shapes: true } });
        }
        if (current.version !== dto.version) throw new ConflictException('平面图版本已变更，请刷新后重试');
        const updated = await tx.floorPlan.updateMany({ where: { id: current.id, version: dto.version }, data: { width: dto.width, depth: dto.depth, backgroundUrl: dto.backgroundUrl, version: { increment: 1 } } });
        if (updated.count !== 1) throw new ConflictException('平面图版本已变更，请刷新后重试');
        await tx.roomShape.deleteMany({ where: { floorPlanId: current.id } });
        await tx.roomShape.createMany({ data: dto.shapes.map((shape) => ({ floorPlanId: current.id, roomId: shape.roomId, kind: shape.kind, x: shape.x, y: shape.y, width: shape.width, depth: shape.depth, rotation: shape.rotation, polygon: shape.polygon as Prisma.InputJsonValue | undefined })) });
        return tx.floorPlan.findUniqueOrThrow({ where: { id: current.id }, include: { shapes: true } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('房间已绑定到其他平面图');
      throw error;
    }
  }

  async createTemplate(buildingId: string, floor: number) {
    await this.assertBuilding(buildingId);
    const rooms = await this.prisma.room.findMany({ where: { buildingId, floor }, orderBy: { roomNumber: 'asc' }, select: { id: true } });
    const existing = await this.prisma.floorPlan.findUnique({ where: { buildingId_floor: { buildingId, floor } } });
    const columns = Math.min(4, Math.max(1, rooms.length));
    const shapes = rooms.map((room, index) => ({ roomId: room.id, kind: 'RECT' as const, x: (index % columns) * 120, y: Math.floor(index / columns) * 100, width: 110, depth: 90 }));
    try {
      if (!existing) return await this.prisma.floorPlan.create({ data: { buildingId, floor, width: columns * 120, depth: Math.max(1, Math.ceil(rooms.length / columns)) * 100, version: 1, shapes: { create: shapes } }, include: { shapes: true } });
      return await this.prisma.$transaction(async (tx) => {
        await tx.floorPlan.update({ where: { id: existing.id }, data: { width: columns * 120, depth: Math.max(1, Math.ceil(rooms.length / columns)) * 100, version: { increment: 1 } } });
        await tx.roomShape.deleteMany({ where: { floorPlanId: existing.id } });
        await tx.roomShape.createMany({ data: shapes.map((shape) => ({ ...shape, floorPlanId: existing.id })) });
        return tx.floorPlan.findUniqueOrThrow({ where: { id: existing.id }, include: { shapes: true } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('房间已绑定到其他平面图');
      throw error;
    }
  }
}
