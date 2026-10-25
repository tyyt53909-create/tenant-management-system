import { describe, expect, it } from 'vitest';
import { canAccessRoute, filterNavigation, roleLabel } from './access';

const nav = [
  { path: '/dashboard', roles: ['ADMIN'] as const },
  { path: '/cleaning', roles: ['ADMIN', 'CLEANER'] as const },
  { path: '/notifications', roles: ['ADMIN', 'CLEANER', 'TENANT'] as const },
  { path: '/open' },
] as const;

describe('路由角色校验（FE-01）', () => {
  it('公开路由任何角色（含未登录）都可访问', () => {
    expect(canAccessRoute(null, { public: true })).toBe(true);
  });

  it('未声明 roles 视为需要登录，不视为放开', () => {
    expect(canAccessRoute(null, {})).toBe(false);
    expect(canAccessRoute('ADMIN', {})).toBe(true);
  });

  it('角色不在允许列表时拒绝', () => {
    expect(canAccessRoute('TENANT', { roles: ['ADMIN'] })).toBe(false);
    expect(canAccessRoute('CLEANER', { roles: ['ADMIN', 'CLEANER'] })).toBe(true);
  });

  it('未知角色字符串不会命中管理员路由', () => {
    expect(canAccessRoute('HACKER', { roles: ['ADMIN'] })).toBe(false);
  });

  it('导航按角色过滤，未登录为空', () => {
    expect(filterNavigation(nav, 'CLEANER').map((i) => i.path)).toEqual([
      '/cleaning',
      '/notifications',
      '/open',
    ]);
    expect(filterNavigation(nav, 'ADMIN').map((i) => i.path)).toEqual([
      '/dashboard',
      '/cleaning',
      '/notifications',
      '/open',
    ]);
    expect(filterNavigation(nav, null)).toEqual([]);
  });

  it('角色文案', () => {
    expect(roleLabel('CLEANER')).toBe('保洁账号');
    expect(roleLabel(undefined)).toBe('当前登录账号');
  });
});
