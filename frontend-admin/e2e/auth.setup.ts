import { test as setup, expect } from '@playwright/test';
import { ADMIN } from './fixtures';

const authFile = 'e2e/.auth/user.json';

/** 登录一次，后续 flows 复用 cookie（refresh 经 HttpOnly Cookie，storageState 可携带） */
setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱或手机号').fill(ADMIN.identifier);
  await page.getByPlaceholder('请输入密码').fill(ADMIN.password);
  await page.getByRole('button', { name: '进入运营中心' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
  await page.context().storageState({ path: authFile });
});
