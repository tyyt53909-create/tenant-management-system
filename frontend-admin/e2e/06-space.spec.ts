import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './fixtures';

/** 流程6：房源模型（2D 剖面 + 3D 等轴模型） */
test.describe('房源模型', () => {
  test.use({ viewport: { width: 878, height: 658 } });

  test('切换 2D/3D、点击房间打开详情，且页面无横向滚动', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/space');

    await expect(page.getByRole('heading', { name: '房源模型', level: 1 })).toBeVisible();
    await expect(page.locator('.space-summary-card')).toHaveCount(5);
    await expect(page.locator('.space-stage-panel')).toBeVisible();
    await expect(page.locator('.scene-canvas')).toBeVisible({ timeout: 15000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    await page.getByRole('button', { name: '2D 剖面' }).click();
    const firstRoom = page.locator('.room').first();
    await expect(firstRoom).toBeVisible({ timeout: 10000 });
    await firstRoom.click();

    await expect(page.locator('.pane-identity')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.room.selected')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭详情面板' }).click();

    await page.getByRole('button', { name: '3D 模型' }).click();
    await expect(page.locator('.scene-canvas')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: '展开', exact: true }).click();
    await expect(page.getByRole('button', { name: '合拢', exact: true })).toBeVisible();
  });
});
