/**
 * 角色与路由权限（FE-01 / T286）。
 *
 * ISS-30：后台路由此前不查角色，任何已登录账号都能打开管理页面（数据虽然后端拦住，
 * 但页面会先渲染、再连续弹 403，误导用户以为是自己操作错了）。
 *
 * 规则：
 * - 路由 `meta.roles` 缺省 = 所有已登录角色可访问；
 * - 路由 `meta.public` = 无需登录；
 * - 角色不在允许列表时跳转 `/forbidden`，不静默跳到工作台（否则用户不知道发生了什么）。
 */

export type AppRole =
  | 'ADMIN'
  | 'PROPERTY_MANAGER'
  | 'FINANCIAL'
  | 'MAINTAINER'
  | 'CLEANER'
  | 'OWNER'
  | 'TENANT';

export interface RouteAccessMeta {
  public?: boolean;
  roles?: AppRole[];
}

/** 判断某角色能否访问目标路由。 */
export function canAccessRoute(
  role: string | null | undefined,
  meta: RouteAccessMeta | Record<string, unknown> | undefined,
): boolean {
  const access = meta as RouteAccessMeta | undefined;
  if (access?.public) return true;
  if (!access?.roles || access.roles.length === 0) return Boolean(role);
  if (!role) return false;
  return (access.roles as string[]).includes(role);
}

/** 过滤导航项：只保留当前角色可见的入口。 */
export function filterNavigation<T extends { path: string; roles?: readonly AppRole[] }>(
  items: readonly T[],
  role: string | null | undefined,
): T[] {
  if (!role) return [];
  return items.filter((item) => !item.roles || item.roles.includes(role as AppRole));
}

export function roleLabel(role: string | null | undefined): string {
  const map: Record<string, string> = {
    ADMIN: '管理员账号',
    PROPERTY_MANAGER: '物业管家',
    FINANCIAL: '财务专员',
    MAINTAINER: '维修师傅',
    CLEANER: '保洁账号',
    OWNER: '业主房东',
    TENANT: '租客账号',
  };
  return map[role ?? ''] || '当前登录账号';
}
