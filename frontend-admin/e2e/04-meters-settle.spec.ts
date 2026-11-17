import { test, expect } from '@playwright/test';
import { setupActiveContract, createMeter, postReading, loginAsAdmin, ensurePrepayFunded, confirmUtilityRuleFixture, apiContext } from './fixtures';

/** 流程4：批量抄表 → 周期结算 */
test.describe('批量抄表并结算', () => {
  test('缺预付账户时保留待结算用量，补开账户后完成结算', async ({ page }) => {
    await loginAsAdmin(page);
    const seed = await setupActiveContract('UI4');
    const meter = await createMeter(seed.buildingId, seed.room.id, seed.uid);
    const meterNumber: string = meter.meterNumber;

    await page.goto('/meters');
    await expect(page.getByRole('row', { name: new RegExp(meterNumber) })).toBeVisible({ timeout: 10000 });

    // ---- 批量抄表：登记初始底数 ----
    await page.getByRole('button', { name: '批量抄表' }).click();
    const sheet = page.getByRole('dialog', { name: /批量抄表/ });
    await expect(sheet).toBeVisible();
    const meterRow = sheet.getByRole('row', { name: new RegExp(meterNumber) });
    await expect(meterRow).toBeVisible({ timeout: 10000 });
    await meterRow.getByPlaceholder('回车下一行').fill('100');
    await page.getByRole('button', { name: /提交抄表/ }).click();
    await page.getByRole('button', { name: '确定提交' }).click();
    await expect(page.getByText(/批量抄表成功/).first()).toBeVisible({ timeout: 15000 });

    // ---- API 追加一条未结算读数（仅采集），UI 做周期结算 ----
    await confirmUtilityRuleFixture(meter.id, seed.contract.id);
    await postReading(meter.id, 150, { autoSettle: false });

    await page.goto('/meters');
    await page.getByRole('row', { name: new RegExp(meterNumber) }).getByRole('button', { name: '结算' }).click();
    const settleDialog = page.getByRole('dialog', { name: /结算/ });
    await expect(settleDialog).toBeVisible();
    const settleButton = settleDialog.getByRole('button', { name: '立即结算' });
    await expect(settleButton).toBeDisabled();
    await expect(settleDialog.getByText('该租客本房间缺少预付账户')).toBeVisible();
    await settleDialog.getByRole('button', { name: '取消', exact: true }).click();

    await ensurePrepayFunded(seed.tenant.id, seed.room.id);
    await page.getByRole('row', { name: new RegExp(meterNumber) }).getByRole('button', { name: '结算' }).click();
    await expect(settleButton).toBeEnabled();
    await settleDialog.getByPlaceholder('例如：2026年10月结账').fill('Playwright 结算备注');
    const succeeded = page.waitForResponse((response) => response.url().endsWith('/utility-charges/confirm') && response.request().method() === 'POST');
    await settleButton.click();
    const confirmation = await succeeded;
    expect(confirmation.request().postDataJSON()).toMatchObject({ notes: 'Playwright 结算备注' });
    expect(await confirmation.json()).toMatchObject({
      status: 'SETTLED', usage: 50, amount: 5000, prepayTransactionId: expect.any(String),
    });
    const { req, headers } = await apiContext();
    try {
      const history = await req.get(`meters/${meter.id}/readings`, { headers });
      expect((await history.json()).data[0].notes).toContain('备注:Playwright 结算备注');
    } finally { await req.dispose(); }
    await expect(settleDialog).toBeHidden();
    await expect(page.getByText(/周期结算成功/).first()).toBeVisible();
  });
});
