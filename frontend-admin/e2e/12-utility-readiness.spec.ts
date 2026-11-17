import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiContext, loginAsAdmin, postReading, setupActiveContract } from './fixtures';
import { assertMarkedPostgres, readLedger, readRuleEvidence } from './postgres';

async function openReview(page: Page, contractNumber: string) {
  await page.goto('/contracts');
  await page.getByPlaceholder('请输入合同编号').fill(contractNumber);
  const filtered = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/contracts' && new URL(res.url()).searchParams.get('contractNumber') === contractNumber);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const result = await filtered;
  expect(result.status()).toBe(200);
  expect((await result.json()).data.map((row: { contractNumber: string }) => row.contractNumber)).toEqual([contractNumber]);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: new RegExp(contractNumber) }) });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '更多合同操作' }).click();
  await page.getByRole('menuitem', { name: '水电规则与交接' }).click();
  const drawer = page.getByRole('dialog', { name: '水电规则与交接' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function choose(page: Page, drawer: Locator, label: string, option: string | RegExp) {
  await drawer.locator('.el-select').filter({ has: page.getByRole('combobox', { name: label, exact: true }) }).click();
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option }).click();
}

async function submit(page: Page, button: Locator, action: string, status = 201) {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled();
  await expect(button).toBeInViewport({ ratio: 0.9 });
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/utility-readiness/${action}` && res.request().method() === 'POST');
  await button.click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(status);
  return result;
}

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]] as const) {
  test(`utility evidence ${name} requires review and safely recovers a lost confirmation after refresh`, async ({ page }) => {
    test.setTimeout(75_000);
    await page.setViewportSize(viewport);
    assertMarkedPostgres();
    const f = await setupActiveContract('RULE');
    const { req, headers } = await apiContext();
    try {
      const meterNumber = `RULE-${randomUUID().slice(0, 8)}`;
      const response = await req.post('meters', { headers, data: {
        buildingId: f.buildingId, roomId: f.room.id, meterNumber, meterType: 'ELECTRICITY',
        unitPrice: 100, priceEffectiveDate: '2026-01-01',
      } });
      expect(response.status(), await response.text()).toBe(201);
      const meter = await response.json();
      const opening = await postReading(meter.id, 100, { autoSettle: false, readingTime: new Date(Date.now() - 120_000).toISOString() });
      const closing = await postReading(meter.id, 110, { autoSettle: false, readingTime: new Date(Date.now() - 60_000).toISOString() });
      const ledger = () => readLedger(f.room.id, f.contract.id, meter.id);
      const evidence = () => readRuleEvidence(f.contract.id, meter.id);
      const before = ledger();
      await loginAsAdmin(page);
      let drawer = await openReview(page, f.contract.contractNumber);
      await choose(page, drawer, '表计', `${meterNumber} · 电表`);
      await expect(drawer.getByText('请核对并明确确认本合同的收款模式及费率')).toBeVisible();
      await expect(drawer.getByRole('button', { name: '检查并预览' })).toBeDisabled();
      await expect(drawer.getByRole('button', { name: '确认规则与责任' })).toHaveCount(0);
      await choose(page, drawer, '起点读数', /^100 ·/);
      await choose(page, drawer, '终点读数', /^110 ·/);
      await choose(page, drawer, '收款模式', '后付，由房东收取');
      await drawer.getByRole('textbox', { name: '每单位费率（分）' }).fill('61.7');
      await drawer.getByRole('textbox', { name: '核验依据与交接说明' }).fill('浏览器核验测试，已核对租约约定与交接读数');
      await submit(page, drawer.getByRole('button', { name: '检查并预览' }), 'preview');
      const forecast = drawer.getByRole('region', { name: '规则预览' });
      await expect(forecast.getByText('费用试算', { exact: true }).locator('..').getByText('¥6.17')).toBeVisible();
      expect(ledger()).toEqual(before);
      expect(evidence()).toEqual({ policies: [], intervals: [], confirmations: 0 });

      // Another operator changes a reviewed source. The browser must explicitly re-review.
      expect((await req.patch(`meters/${meter.id}`, { headers, data: { unitPrice: 200 } })).status()).toBe(200);
      const stale = await submit(page, drawer.getByRole('button', { name: '确认规则与责任' }), 'confirm', 409);
      expect((await stale.json()).code).toBe('PREVIEW_STALE');
      expect(evidence().confirmations).toBe(0);
      expect(ledger()).toEqual(before);
      await submit(page, drawer.getByRole('button', { name: '检查并预览' }), 'preview');

      // The actual PostgreSQL commit succeeds, then the transport loses the response.
      let committed!: () => void;
      const lostResponse = new Promise<void>((resolve) => { committed = resolve; });
      await page.route('**/api/utility-readiness/confirm', async (route) => {
        const res = await route.fetch();
        expect(res.status(), await res.text()).toBe(201);
        await route.abort('failed');
        committed();
      });
      const confirmation = drawer.getByRole('button', { name: '确认规则与责任' });
      await confirmation.scrollIntoViewIfNeeded();
      await expect(confirmation).toBeInViewport({ ratio: 0.9 });
      await confirmation.click();
      await lostResponse;
      await page.unroute('**/api/utility-readiness/confirm');
      const saved = evidence();
      expect(saved).toMatchObject({ policies: [{ version: 1, collectionMode: 'POSTPAID', rateCents: 61.7 }], confirmations: 1 });
      expect(saved.intervals).toMatchObject([{
        contractId: f.contract.id, tenantId: f.tenant.id, openingReadingId: opening.reading.id, closingReadingId: closing.reading.id,
      }]);
      expect(ledger()).toEqual(before);

      await page.reload();
      drawer = await openReview(page, f.contract.contractNumber);
      await submit(page, drawer.getByRole('button', { name: '重试上次确认' }), 'confirm');
      expect(evidence()).toEqual(saved);
      expect(ledger()).toEqual(before);
      await choose(page, drawer, '表计', `${meterNumber} · 电表`);
      await expect(drawer.getByRole('region', { name: '已确认责任段' })).toContainText('本合同租客');
      await expect(drawer.getByText(/已确认第 1 版/)).toBeVisible();
      await expect(drawer.getByRole('button', { name: '关闭此对话框' })).toBeInViewport({ ratio: 0.9 });
      await page.screenshot({ path: test.info().outputPath(`utility-readiness-${name}.png`) });
    } finally { await req.dispose(); }
  });
}
