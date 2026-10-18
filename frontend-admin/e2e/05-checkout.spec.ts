import { test, expect } from '@playwright/test';
import { setupActiveContract, loginAsAdmin } from './fixtures';

/** 流程5：退租结算（含押金扣除项） */
test.describe('退租结算', () => {
  test('新增退租记录并确认为已完成', async ({ page }) => {
    await loginAsAdmin(page);
    const seed = await setupActiveContract('UI5');

    await page.goto('/checkout');
    await page.getByRole('button', { name: '新增退租记录' }).first().click();
    const dialog = page.getByRole('dialog', { name: '新增退租记录' });
    await expect(dialog).toBeVisible();

    // 关联合同：选项文案为“合同编号 · 房间号 · 租客名”，用房间号精确定位
    await dialog.getByTestId('entity-select-contracts').click();
    await page.getByRole('option', { name: new RegExp(seed.room.roomNumber) }).click();

    const dateInput = dialog.getByPlaceholder('选择日期').first();
    await dateInput.fill('2026-10-17');
    await dateInput.press('Enter');

    await dialog.locator('.el-form-item:has(label:text-is("退款金额(元)")) input').fill('5200');

    // 押金扣除项
    await dialog.getByRole('button', { name: '+ 添加押金扣除项' }).click();
    const itemRow = dialog.locator('tr', { hasText: '押金扣除' }).last();
    await itemRow.getByPlaceholder('0.00').fill('800');
    await itemRow.getByPlaceholder(/押金扣除请写明/).fill('墙面破损修补');

    await dialog.getByRole('button', { name: '确定' }).click();
    await expect(page.getByText('创建成功').first()).toBeVisible({ timeout: 8000 });

    // 列表「关联合同」列显示的是合同编号（不再是裸 cuid），按业务标识定位（T212）
    const row = page.getByRole('row', { name: new RegExp(seed.contract.contractNumber) });
    await expect(row).toBeVisible({ timeout: 8000 });
    await expect(row).toContainText('草稿');

    // 编辑改为已完成
    await row.getByRole('button', { name: '编辑' }).click();
    const editDialog = page.getByRole('dialog', { name: /退租/ });
    await expect(editDialog).toBeVisible();
    const statusSelect = editDialog.locator('.el-form-item:has(label:text-is("状态")) .el-select');
    if (await statusSelect.count()) {
      await statusSelect.click();
      await page.getByRole('option', { name: '已完成' }).click();
      await editDialog.getByRole('button', { name: '确定' }).click();
      // 复用上面的 row 定位（同样按合同编号，T212）
      await expect(row).toContainText('已完成', { timeout: 8000 });
    }
  });
});
