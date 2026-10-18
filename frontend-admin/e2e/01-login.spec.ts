import { test, expect } from '@playwright/test';

/** 流程1：登录（独立上下文，不复用 setup 的登录态） */
test.describe('登录', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('账号密码正确进入运营中心', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('请输入邮箱或手机号').fill('admin@example.com');
    await page.getByPlaceholder('请输入密码').fill('Admin@123');
    await page.getByRole('button', { name: '进入运营中心' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
  });

  test('密码错误停留在登录页并提示', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('请输入邮箱或手机号').fill('admin@example.com');
    await page.getByPlaceholder('请输入密码').fill('wrong-password');
    await page.getByRole('button', { name: '进入运营中心' }).click();
    await expect(page).not.toHaveURL(/\/dashboard$/, { timeout: 10000 });
    await expect(page.locator('.el-message--error, .el-notification--error').first()).toBeVisible({ timeout: 8000 });
  });
});
