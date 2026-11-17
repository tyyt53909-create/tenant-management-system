import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { apiContext, confirmUtilityRuleFixture, createMeter, ensurePrepayFunded, loginAsAdmin, postReading, setupActiveContract } from './fixtures';
import { assertMarkedPostgres, readLedger, readUtilityCharges } from './postgres';

async function openPosting(page: Page, contract: string, meter: string) {
  await page.goto('/contracts');
  await page.getByPlaceholder('请输入合同编号').fill(contract);
  const filtered = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/contracts' && new URL(res.url()).searchParams.get('contractNumber') === contract);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  expect((await filtered).status()).toBe(200);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: new RegExp(contract) }) });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '更多合同操作' }).click();
  await page.getByRole('menuitem', { name: '水电规则与交接' }).click();
  const drawer = page.getByRole('dialog', { name: '水电规则与交接' });
  await drawer.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '表计', exact: true }) }).click();
  await page.getByRole('listbox', { name: '表计', exact: true }).getByRole('option', { name: `${meter} · 电表` }).click();
  return drawer.getByRole('region', { name: '正式水电计费' });
}

for (const [layout, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
  for (const mode of ['PREPAY_WITH_SHORTFALL', 'POSTPAID', 'DIRECT_TO_PROVIDER']) {
    test(`formal utility ${mode} ${layout}: read-only preview and refresh retry preserve one charge`, async ({ page }) => {
      test.setTimeout(75_000);
      await page.setViewportSize(viewport); assertMarkedPostgres();
      const f = await setupActiveContract('POST');
      const meter = await createMeter(f.buildingId, f.room.id, randomUUID());
      await ensurePrepayFunded(f.tenant.id, f.room.id, mode === 'PREPAY_WITH_SHORTFALL' ? 200 : 1000);
      await postReading(meter.id, 100, { autoSettle: false, readingTime: new Date(Date.now() - 120_000).toISOString() });
      await confirmUtilityRuleFixture(meter.id, f.contract.id, '61.7', mode);
      await postReading(meter.id, 110, { autoSettle: false, readingTime: new Date(Date.now() - 60_000).toISOString() });
      const before = readLedger(f.room.id, f.contract.id, meter.id);
      await loginAsAdmin(page);
      let panel = await openPosting(page, f.contract.contractNumber, meter.meterNumber);
      await expect(panel.getByRole('button', { name: '确认正式计费' })).toHaveCount(0);
      const review = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/utility-charges/preview');
      await panel.getByRole('button', { name: '预览正式费用' }).click();
      expect((await review).status()).toBe(201);
      await expect(panel.getByText('本次费用', { exact: true }).locator('..').getByText('¥6.17')).toBeVisible();
      expect(readLedger(f.room.id, f.contract.id, meter.id)).toEqual(before);
      expect(readUtilityCharges(meter.id)).toEqual([]);
      let committed!: () => void;
      const done = new Promise<void>((resolve) => { committed = resolve; });
      await page.route('**/api/utility-charges/confirm', async (route) => {
        const result = await route.fetch();
        expect(result.status(), await result.text()).toBe(201);
        committed(); await route.abort('failed');
      });
      const confirm = panel.getByRole('button', { name: '确认正式计费', exact: true });
      await confirm.scrollIntoViewIfNeeded(); await expect(confirm).toBeEnabled(); await expect(confirm).toBeInViewport({ ratio: 0.9 });
      await confirm.click(); await done;
      await expect(panel.getByRole('button', { name: '重试上次计费' })).toBeEnabled();
      await page.unroute('**/api/utility-charges/confirm');
      const after = readLedger(f.room.id, f.contract.id, meter.id);
      const charges = readUtilityCharges(meter.id);
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({ tenantId: f.tenant.id, contractId: f.contract.id, collectionMode: mode, totalAmount: 617, prepayApplied: mode === 'PREPAY_WITH_SHORTFALL' ? 200 : 0, receivableAmount: mode === 'PREPAY_WITH_SHORTFALL' ? 417 : mode === 'POSTPAID' ? 617 : 0, providerAmount: mode === 'DIRECT_TO_PROVIDER' ? 617 : 0, confirmations: 1 });
      expect(after.room).toEqual(before.room); expect(after.lease).toEqual(before.lease); expect(after.payments).toBe(before.payments);
      expect(after.accounts[0].balanceCache).toBe(mode === 'PREPAY_WITH_SHORTFALL' ? 0 : 1000);
      expect(after.bills.filter((b) => b.billType === 'UTILITY')).toHaveLength(mode === 'DIRECT_TO_PROVIDER' ? 0 : 1);
      expect(after.debits).toHaveLength(mode === 'PREPAY_WITH_SHORTFALL' ? 1 : 0);
      await page.reload(); panel = await openPosting(page, f.contract.contractNumber, meter.meterNumber);
      const replay = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/utility-charges/confirm');
      const retry = panel.getByRole('button', { name: '重试上次计费' });
      await retry.scrollIntoViewIfNeeded(); await expect(retry).toBeEnabled(); await retry.click();
      expect((await replay).status()).toBe(201);
      await expect(panel.getByRole('status')).toContainText('费用已处理');
      expect(readLedger(f.room.id, f.contract.id, meter.id)).toEqual(after);
      expect(readUtilityCharges(meter.id)).toEqual(charges);
      await page.screenshot({ path: test.info().outputPath('formal-posting.png'), fullPage: false });
      const { req, headers } = await apiContext();
      try {
        const repeated = await req.post(`meters/${meter.id}/settle`, { headers, data: {} });
        expect((await repeated.json()).reasonCode).toBe('ALREADY_SETTLED');
        expect(readUtilityCharges(meter.id)).toEqual(charges);
      } finally { await req.dispose(); }
    });
  }
}
