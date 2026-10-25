import { test, expect } from '@playwright/test';
import { setupActiveContract, createPendingBill, loginAsAdmin } from './fixtures';

/** 流程3：新增账单 → 收款（行级状态 待支付 → 已支付） */
test.describe('账单收款', () => {
  test('对新账单登记全额收款并变为已支付', async ({ page }) => {
    await loginAsAdmin(page);
    const seed = await setupActiveContract('UI3');
    const bill = await createPendingBill(seed.contract.id, seed.uid.slice(-4));

    await page.goto('/bills');
    const row = page.getByRole('row', { name: new RegExp(bill.billNumber) });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText('待支付');

    await row.getByRole('button', { name: '收款' }).click();
    const payDialog = page.getByRole('dialog', { name: '登记收款' });
    await expect(payDialog).toBeVisible();

    const txn = `PWTXN${Date.now().toString(36)}`;
    await payDialog.getByPlaceholder('选填；同一账单内不可重复').fill(txn);
    await payDialog.getByRole('button', { name: '确认收款' }).click();

    await expect(page.getByText('收款登记成功').first()).toBeVisible({ timeout: 8000 });
    // 弹窗关闭后行状态更新（bill 金额唯一，行内 billNumber 可二次确认）
    await expect(page.getByRole('dialog', { name: '登记收款' })).toBeHidden({ timeout: 8000 });
    await expect(page.getByText(bill.billNumber).first()).toBeVisible({ timeout: 8000 });
    await expect(row).toContainText('已支付', { timeout: 8000 });
  });
});
