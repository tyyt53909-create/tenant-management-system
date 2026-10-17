import { test, expect } from '@playwright/test';
import { setupActiveContract, loginAsAdmin } from './fixtures';

/** 流程2：建房源 → 签合同（全 UI） */
test.describe('建房源并签合同', () => {
  test('新增房源后为其签合同，列表可查到新行', async ({ page }) => {
    await loginAsAdmin(page);
    const seed = await setupActiveContract('UI2');
    // 用预置的租客（避免再走租客新建页），房源走 UI 新建
    const roomNumber = seed.room.roomNumber + 'B';
    const tenantName = seed.tenant.name;

    // ---- 新建房源 ----
    await page.goto('/rooms');
    await page.getByRole('button', { name: /新增房源/ }).click();
    const roomDialog = page.getByRole('dialog', { name: '新增房源' });
    await expect(roomDialog).toBeVisible();

    await roomDialog.getByTestId('entity-select-buildings').click();
    await page.getByRole('option').first().click();
    await roomDialog.getByPlaceholder('请输入房间号').fill(roomNumber);
    await roomDialog.locator('.el-form-item:has(label:text-is("楼层")) input').fill('5');
    await roomDialog.locator('.el-form-item:has(label:text-is("房型")) .el-select').click();
    await page.getByRole('option', { name: '单间' }).click();
    await roomDialog.getByRole('button', { name: '确定' }).click();

    await expect(page.getByText('创建成功').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('row', { name: new RegExp(roomNumber) })).toBeVisible({ timeout: 8000 });

    // ---- 新建合同（房源选刚建的，租客用预置的） ----
    await page.goto('/contracts');
    await page.getByRole('button', { name: /新增合同/ }).click();
    const contractDialog = page.getByRole('dialog', { name: '新增合同' });
    await expect(contractDialog).toBeVisible();

    await contractDialog.getByTestId('entity-select-buildings').click();
    await page.getByRole('option').first().click();
    await contractDialog.getByTestId('entity-select-rooms').click();
    await page.getByRole('option', { name: new RegExp(roomNumber) }).click();
    await contractDialog.getByTestId('entity-select-tenants').click();
    await page.getByRole('option', { name: new RegExp(tenantName) }).click();

    // 日期控件为 readonly：去 readonly 后直接填值（value-format YYYY-MM-DD）
    const start = contractDialog.getByPlaceholder('选择日期').nth(0);
    const end = contractDialog.getByPlaceholder('选择日期').nth(1);
    await start.fill('2026-10-20');
    await start.press('Enter');
    await end.fill('2027-10-19');
    await end.press('Enter');

    await contractDialog.locator('.el-form-item:has(label:text-is("租金(元)")) input').fill('3000');
    await contractDialog.locator('.el-form-item:has(label:text-is("押金(元)")) input').fill('6000');
    await contractDialog.getByRole('button', { name: '确定' }).click();

    await expect(page.getByText('创建成功').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('row', { name: new RegExp(roomNumber) })).toBeVisible({ timeout: 8000 });
  });
});
