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
      // 缺失即启动失败（fail-closed）。此前回退到 'fallback-secret' 会让配置缺失时
      // 仍用公开已知密钥验签（ISS-09）。
      secretOrKey: configService.getOrThrow<string>('jwt.secret'),
      // 只接受 HS256，拒绝 alg=none / 非对称算法混淆。
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    // 明确 Token 用途防混用：禁止使用 Refresh Token 访问受保护业务接口
    if (payload.tokenType === 'REFRESH') {
      throw new UnauthorizedException('禁止使用 Refresh Token 访问受保护接口');
    }

    // 验证用户是否存在且激活，并一次性带出租客档案（ISS-49：原先 TENANT 每请求
    // 要额外查一次 tenant；改为单次 Prisma 查询 + 关系选择，角色/档案同时取回）。
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        isActive: true,
        tenant: { select: { id: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('用户不存在或已禁用');
    }

    // 安全红线：TENANT 账号必须有租客档案。
    //
    // 若此处放行 tenantId=undefined，下游 `where: { tenantId: undefined }`
    // 会被 Prisma 当作「不加过滤」，导致租客可读取全库账单/合同/预付账户
    // （2026-10-13 实测：越权读到 49 张账单、35 份合同）。
    // 因此在鉴权阶段直接拒绝，确保 tenantId 永不为 undefined。
    let tenantId: string | undefined;
    if (user.role === 'TENANT') {
      tenantId = user.tenant?.id;
      if (!tenantId) {
        throw new UnauthorizedException('租客档案不存在或已解绑，请联系管理员');
      }
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
