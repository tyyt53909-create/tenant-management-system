import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记无需登录即可访问的路由（或在控制器类上整体标记）。
 *
 * 全局 JwtAuthGuard 默认拒绝所有未携带有效 Token 的请求，
 * 只有显式标注 @Public() 的处理器才放行。新增公开接口必须同时
 * 更新 `backend/test/route-policy.snapshot.json`（测试会提示）。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
