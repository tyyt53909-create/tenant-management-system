import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * JWT 守卫（T257 / SEC-01）。
 *
 * 作为全局 APP_GUARD 注册，**默认拒绝**：未标注 @Public() 的路由一律要求
 * 有效 Bearer Token。公开路由（登录、注册、健康检查、公开看房等）必须
 * 在控制器类或方法上显式标注 @Public()。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
