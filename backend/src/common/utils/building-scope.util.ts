import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../modules/prisma/prisma.service.js';

export interface ScopedStaffContext {
  userId: string;
  role: string;
}

/**
 * 员工楼栋管辖范围解析器（DEC-08 / WRK-01）。
 * - ADMIN 具有全局楼栋访问权限，返回 null（表示不增加楼栋约束）。
 * - 其他员工角色返回其管辖的 buildingId 集合。
 */
export async function getStaffBuildingScope(
  prisma: PrismaService,
  staff: ScopedStaffContext,
): Promise<string[] | null> {
  if (staff.role === 'ADMIN') {
    return null; // 全局访问
  }

  const assignments = await prisma.staffBuildingAssignment.findMany({
    where: { userId: staff.userId },
    select: { buildingId: true },
  });

  return assignments.map((a) => a.buildingId);
}

/**
 * 校验员工是否有权访问指定楼栋
 */
export async function assertStaffBuildingAccess(
  prisma: PrismaService,
  staff: ScopedStaffContext,
  buildingId: string,
): Promise<void> {
  if (staff.role === 'ADMIN') {
    return;
  }

  const assigned = await prisma.staffBuildingAssignment.findFirst({
    where: { userId: staff.userId, buildingId },
    select: { id: true },
  });

  if (!assigned) {
    throw new ForbiddenException('您无权访问或操作该楼栋的数据');
  }
}
