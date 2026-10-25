import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './fixtures';

/**
 * FE-01 / T286：后台路由按角色拦截。
 *
 * 用真实管理员登录拿到会话，再把 `/auth/me` 换成保洁角色：
 * 这样能验证「前端路由守卫 + 导航过滤」，而不依赖真实保洁账号的密码。
 */
const CLEANER_ME = {
  id: 'cleaner-1',
  email: 'cleaner@example.com',
  phone: null,
  role: 'CLEANER',
  isActive: true,
  invitedBy: null,
  tenant: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  avatarUrl: null,
  capabilities: [],
  features: { meterSimulator: false },
};

test.describe('角色路由（FE-01）', () => {
  test('保洁访问管理员页面被拦到 /forbidden，侧栏只留可用入口', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CLEANER_ME),
      }),
    );

    await page.goto('/bills');
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByRole('heading', { name: '当前账号无权访问这个页面' })).toBeVisible();

    const nav = page.getByRole('navigation', { name: '管理导航' });
    await expect(nav.getByRole('link', { name: /保洁任务/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: /账单与收款/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /租客档案/ })).toHaveCount(0);
  });

  test('管理员正常进入工作台，不被误拦', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/bills');
    await expect(page).not.toHaveURL(/\/forbidden/);
  });
});
