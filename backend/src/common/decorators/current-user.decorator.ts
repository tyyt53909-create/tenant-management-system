import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId?: string;
  role?: string;
  tenantId?: string;
  buildingId?: string;
  id?: string;
  [key: string]: unknown;
}

export type CurrentUserParam = AuthUser | { user?: AuthUser } | undefined;

/**
 * 统一解析当前认证用户（同时兼容 NestJS 运行时注入与单测直接传递 { user: ... } 结构）
 */
export function resolveAuthUser(userOrReq?: CurrentUserParam): AuthUser & { userId: string; role: string } {
  const base = (!userOrReq
    ? {}
    : typeof userOrReq === 'object' && 'user' in userOrReq && userOrReq.user
      ? userOrReq.user
      : userOrReq) as Record<string, unknown>;

  const userId = typeof base.userId === 'string'
    ? base.userId
    : typeof base.id === 'string'
      ? base.id
      : '';
  const role = typeof base.role === 'string' ? base.role : '';
  return {
    ...base,
    userId,
    role,
  };
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request?.user ?? { userId: '', role: '' };
  },
);
