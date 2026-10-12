import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BuildingGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 管理员可以访问所有数据
    if (user.role === 'ADMIN') {
      return true;
    }

    // 租客只能访问自己的数据
    if (user.role === 'TENANT') {
      // 从请求中获取资源 ID
      const resourceId = request.params.id;
      const query = request.query;

      // 如果有 buildingId 查询参数，验证租客是否属于该楼栋
      if (query.buildingId) {
        const hasAccess = await this.checkBuildingAccess(
          user.id,
          query.buildingId,
        );
        if (!hasAccess) {
          throw new ForbiddenException('无权访问该楼栋的数据');
        }
      }

      // 注入租客过滤条件到请求中
      request.tenantFilter = { tenantId: user.id };
    }

    return true;
  }

  private async checkBuildingAccess(
    userId: string,
    buildingId: string,
  ): Promise<boolean> {
    // 检查用户是否有该楼栋的活跃合同
    const contract = await this.prisma.contract.findFirst({
      where: {
        tenantId: userId,
        buildingId: buildingId,
        status: 'ACTIVE',
      },
    });

    return !!contract;
  }
}
