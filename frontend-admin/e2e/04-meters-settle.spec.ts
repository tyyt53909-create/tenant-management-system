import { test, expect } from '@playwright/test';
import { setupActiveContract, createMeter, postReading, loginAsAdmin, ensurePrepayFunded, API_BASE, ADMIN, uid } from './fixtures';

/** 流程4：批量抄表 → 周期结算 */
test.describe('批量抄表并结算', () => {
  test('缺预付账户时保留待结算用量，补开账户后完成结算', async ({ page }) => {
    test.setTimeout(60_000);
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
    await postReading(meter.id, 150, { autoSettle: false });

    await page.goto('/meters');
    const openSettlement = () => page.getByRole('row', { name: new RegExp(meterNumber) }).getByRole('button', { name: '结算' }).click();
    await openSettlement();
    const settleDialog = page.getByRole('dialog', { name: /结算/ });
    await expect(settleDialog).toBeVisible();
    const settleButton = settleDialog.getByRole('button', { name: '立即结算' });
    await expect(settleDialog.getByText('无预付账户')).toBeVisible();
    const responseForSettlement = () => page.waitForResponse(
      (response) => response.url().endsWith(`/meters/${meter.id}/settle`) && response.request().method() === 'POST',
    );
    const blocked = responseForSettlement();
    await settleButton.click();
    const blockedResponse = await blocked;
    const originalScope = blockedResponse.request().postDataJSON();
    expect(originalScope).toMatchObject({
      settleUntil: expect.any(String), expectedTargetReadingId: expect.any(String), expectedBaselineReading: 100,
    });
    expect(await blockedResponse.json()).toMatchObject({
      status: 'BLOCKED', reasonCode: 'MISSING_PREPAY_ACCOUNT', settled: false, usage: 50,
    });
    await expect(page.getByText(/开立预付账户.*重试/)).toBeVisible();
    await expect(settleDialog).toBeVisible();

    const laterReading = (await postReading(meter.id, 175, { autoSettle: false })).reading;
    expect(Date.parse(laterReading.readingTime)).toBeGreaterThan(Date.parse(originalScope.settleUntil));
    await ensurePrepayFunded(seed.tenant.id, seed.room.id);
    const succeeded = responseForSettlement();
    await settleButton.click();
    const retried = await succeeded;
    expect(retried.request().postDataJSON()).toEqual(originalScope);
    expect(await retried.json()).toMatchObject({
      status: 'SETTLED', usage: 50, amount: 5000, prepayTransactionId: expect.any(String),
    });
    await expect(settleDialog).toBeHidden();
    await expect(page.getByText(/周期结算成功/).first()).toBeVisible();

    await openSettlement();
    await expect(settleDialog.getByText('¥25.00', { exact: true })).toBeVisible();
    await expect(settleButton).toBeEnabled();
    // 时间相同但后插入的补录被选成最新目标，旧预览必须作废。
    await postReading(meter.id, 180, { autoSettle: false, readingTime: laterReading.readingTime });
    const stale = responseForSettlement();
    await settleButton.click();
    expect(await (await stale).json()).toMatchObject({ status: 'BLOCKED', reasonCode: 'PREVIEW_STALE' });
    await expect(settleDialog.getByText(/刷新结算预览并核对用量后重新确认/)).toBeVisible();
    await expect(settleButton).toBeDisabled();
    await settleDialog.getByRole('button', { name: '刷新结算预览' }).click();
    await expect(settleDialog.getByText('¥30.00', { exact: true })).toBeVisible();
    await expect(settleButton).toBeEnabled();
  });

  test('无生效合同和缺预付账户分别显示逐表处理原因', async ({ page, request }) => {
    await loginAsAdmin(page);
    const seed = await setupActiveContract('UI4MIX');
    const signed = await createMeter(seed.buildingId, seed.room.id, seed.uid);
    const login = await request.post(`${API_BASE}/auth/login`, { data: ADMIN });
    expect(login.status()).toBe(201);
    const room = await request.post(`${API_BASE}/rooms`, {
      headers: { Authorization: `Bearer ${(await login.json()).accessToken}` },
      data: { buildingId: seed.buildingId, roomNumber: `PW${uid()}`, floor: 3, roomType: 'SINGLE' },
    });
    expect(room.status()).toBe(201);
    const vacant = await createMeter(seed.buildingId, (await room.json()).id, uid());
    await postReading(signed.id, 100, { autoSettle: false });
    await postReading(vacant.id, 100, { autoSettle: false });

    await page.goto('/meters');
    await page.getByRole('button', { name: '批量抄表' }).click();
    const sheet = page.getByRole('dialog', { name: /批量抄表/ });
    for (const meter of [signed, vacant]) {
      await sheet.getByRole('row', { name: new RegExp(meter.meterNumber) }).getByPlaceholder('回车下一行').fill('110');
    }
    await sheet.getByRole('button', { name: /提交抄表/ }).click();
    await page.getByRole('button', { name: '确定提交' }).click();
    const results = page.getByRole('dialog', { name: '批量抄表结果' });
    await expect(results.getByText('登记成功 2 条，登记失败 0 条，结算待处理 2 条。')).toBeVisible();
    await expect(results.getByText(new RegExp(`${vacant.meterNumber}.*未找到生效合同.*核对.*租约`))).toBeVisible();
    await expect(results.getByText(new RegExp(`${signed.meterNumber}.*无预付账户.*开立预付账户`))).toBeVisible();
  });
});
