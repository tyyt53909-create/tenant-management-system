import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FloorPlansService } from './floor-plans.service.js';
import { ShapeKindDto } from './dto/save-floor-plan.dto.js';

const setup = () => {
  const prisma = {
    building: { findUnique: vi.fn().mockResolvedValue({ id: 'b1' }) },
    room: { findMany: vi.fn().mockResolvedValue([]) },
    roomShape: { findMany: vi.fn().mockResolvedValue([]) },
    floorPlan: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: any) => unknown) => fn({
      floorPlan: { findUnique: prisma.floorPlan.findUnique, create: prisma.floorPlan.create, updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: prisma.floorPlan.findUniqueOrThrow },
      roomShape: { deleteMany: vi.fn(), createMany: vi.fn() },
    })),
  };
  return { prisma, service: new FloorPlansService(prisma as never) };
};

describe('FloorPlansService', () => {
  it('returns 404 when building is missing', async () => {
    const { service, prisma } = setup();
    prisma.building.findUnique.mockResolvedValue(null);
    await expect(service.findAll('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 409 for duplicate room bindings in one save', async () => {
    const { service } = setup();
    const shape = { roomId: 'r1', kind: ShapeKindDto.RECT, x: 0, y: 0, width: 10, depth: 10 };
    await expect(service.save('b1', 1, { width: 10, depth: 10, version: 0, shapes: [shape, shape] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 409 on optimistic version conflict', async () => {
    const { service, prisma } = setup();
    prisma.floorPlan.findUnique.mockResolvedValue({ id: 'p1', version: 2 });
    const tx = { floorPlan: { findUnique: prisma.floorPlan.findUnique, updateMany: vi.fn(), findUniqueOrThrow: vi.fn() }, roomShape: { deleteMany: vi.fn(), createMany: vi.fn() } };
    prisma.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));
    await expect(service.save('b1', 1, { width: 10, depth: 10, version: 1, shapes: [] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('includes every room when generating a template', async () => {
    const { service, prisma } = setup();
    prisma.room.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` })));
    prisma.floorPlan.findUnique.mockResolvedValue(null);
    prisma.floorPlan.create.mockImplementation(async ({ data, include }: any) => ({ ...data, shapes: include ? data.shapes.create : undefined }));
    const result = await service.createTemplate('b1', 2);
    expect(result.shapes).toHaveLength(5);
    expect(result.shapes.map((shape: { roomId: string | null }) => shape.roomId)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
});
