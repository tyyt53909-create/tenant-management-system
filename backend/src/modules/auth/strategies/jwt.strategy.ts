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
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.secret') || 'fallback-secret',
    });
  }

  async validate(payload: JwtPayload) {
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
      tenantId = tenant?.id;
    }

    // 返回用户信息，会被附加到 request.user
    return {
      userId: payload.sub,
      role: payload.role,
      buildingId: payload.buildingId,
      tenantId,
    };
  }
}
