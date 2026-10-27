import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtPayload } from '../jwt.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('jwt.secret');
    if (!secret) {
      throw new Error('JWT_SECRET 未配置，拒绝启动');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    // 明确 Token 用途防混用：禁止使用 Refresh Token 访问受保护业务接口
    if (payload.tokenType === 'REFRESH') {
      throw new UnauthorizedException('禁止使用 Refresh Token 访问受保护接口');
    }

    // 验证用户是否存在且激活
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('用户不存在或已禁用');
    }

    // 查询租客ID（租客角色需要，用于租客范围查询）
    let tenantId: string | undefined;
    if (user.role === 'TENANT') {
      const tenant = await this.prisma.tenant.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });

      // 安全红线：TENANT 账号必须有租客档案。
      //
      // 若此处放行 tenantId=undefined，下游 `where: { tenantId: undefined }`
      // 会被 Prisma 当作「不加过滤」，导致租客可读取全库账单/合同/预付账户
      // （2026-10-13 实测：越权读到 49 张账单、35 份合同）。
      // 因此在鉴权阶段直接拒绝，确保 tenantId 永不为 undefined。
      if (!tenant) {
        throw new UnauthorizedException('租客档案不存在或已解绑，请联系管理员');
      }
      tenantId = tenant.id;
    }

    // 返回用户信息，会被附加到 request.user
    return {
      userId: payload.sub,
      // 权限以当前数据库角色为准；旧 ADMIN token 在降权后不得继续读合同附件或管理摘要。
      role: user.role,
      buildingId: payload.buildingId,
      tenantId,
    };
  }
}
