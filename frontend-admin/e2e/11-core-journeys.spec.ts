import { randomInt, randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { apiContext, loginAsAdmin, postReading, ensurePrepayFunded } from './fixtures';
import { assertMarkedPostgres, readBatch, readLedger } from './postgres';

type Auth = Awaited<ReturnType<typeof apiContext>>;
type Building = { id: string; name: string };
type Subject = {
  room: { id: string; roomNumber: string; version: number };
  tenant: { id: string; name: string };
  contract: { id: string; contractNumber: string };
  meter: { id: string; meterNumber: string };
};

async function created<T>(response: APIResponse, status = 201): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json() as Promise<T>;
}

async function building({ req, headers }: Auth) {
  const name = `PW-${randomUUID().slice(0, 8)}`;
  return created<Building>(await req.post('buildings', { headers, data: { name, floors: 3 } }));
}

async function subject({ req, headers }: Auth, site: Building, tag: string): Promise<Subject> {
  const room = await created<Subject['room']>(await req.post('rooms', { headers, data: {
    buildingId: site.id, roomNumber: `${site.name}-${tag}`, floor: 1, roomType: 'SINGLE', area: 25,
  } }));
  const tenant = await created<Subject['tenant']>(await req.post('tenants', { headers, data: {
    name: `租客-${site.name}-${tag}`, phone: `139${String(randomInt(100_000_000)).padStart(8, '0')}`,
  } }));
  const now = new Date();
  const startDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' })
    .format(now) + '-01';
  const endDate = new Date(now.getTime() + 365 * 86400_000).toISOString().slice(0, 10);
  const contract = await created<Subject['contract']>(await req.post('contracts', { headers, data: {
    buildingId: site.id, roomId: room.id, tenantId: tenant.id,
    rentAmount: 300000, depositAmount: 600000, paymentCycle: 'MONTHLY', paymentDay: 5, startDate, endDate,
  } }));
  const meter = await created<Subject['meter']>(await req.post('meters', { headers, data: {
    buildingId: site.id, roomId: room.id, meterType: 'ELECTRICITY',
    meterNumber: `M-${site.name}-${tag}`, unitPrice: 100, priceEffectiveDate: startDate,
  } }));
  return { room, tenant, contract, meter };
}

const ledger = (s: Subject) => readLedger(s.room.id, s.contract.id, s.meter.id);

async function visibleAction(button: Locator) {
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport({ ratio: 0.9 });
}

async function submission(page: Page, button: Locator, path: string, status = 201) {
  await visibleAction(button);
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/${path}`
    && res.request().method() === 'POST');
  await button.click();
  const res = await response;
  expect(res.status(), await res.text()).toBe(status);
  return res;
}

async function moveInPreview(page: Page, s: Subject) {
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: new RegExp(s.room.roomNumber) }) });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '更多房源操作' }).click();
  await page.getByRole('menuitem', { name: '办理入住' }).click();
  const dialog = page.getByRole('dialog', { name: '办理入住' });
  await expect(dialog).toBeVisible();
  await submission(page, dialog.getByRole('button', { name: '预览入住' }), `rooms/${s.room.id}/move-in/preview`);
  await expect(dialog.getByText(s.tenant.name, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('row', { name: /首期租金.*3,000\.00/ })).toBeVisible();
  await expect(dialog.getByRole('row', { name: /押金.*6,000\.00/ })).toBeVisible();
  await expect(dialog.getByText('¥3,000.00', { exact: true })).toBeInViewport();
  await expect(dialog.getByText('¥6,000.00', { exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '确认入住' })).toBeDisabled();
  await dialog.getByRole('spinbutton').fill('100');
  await dialog.getByRole('spinbutton').press('Tab');
  return dialog;
}

async function activateWithoutAccount({ req, headers }: Auth, s: Subject) {
  const reserved = await created<{ version: number }>(await req.patch(`rooms/${s.room.id}/status`, {
    headers, data: { status: 'RESERVED', version: s.room.version },
  }), 200);
  await created(await req.post(`contracts/${s.contract.id}/confirm`, { headers }));
  await created(await req.patch(`rooms/${s.room.id}/status`, {
    headers, data: { status: 'OCCUPIED', version: reserved.version },
  }), 200);
  await postReading(s.meter.id, 100, { autoSettle: false });
}

async function selectBuilding(page: Page, site: Building) {
  await page.getByTestId('entity-select-buildings').getByRole('combobox').click();
  await page.getByRole('option', { name: site.name, exact: true }).click();
}

async function approveCharges(page: Page, batch: string, amount: string, status = 201) {
  const action = page.getByRole('button', { name: '确认执行 1', exact: true });
  await visibleAction(action);
  await action.click();
  const dialog = page.getByRole('dialog', { name: '确认周期收费' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`1 项，共 ¥${amount}`, { exact: false })).toBeInViewport();
  await submission(page, dialog.getByRole('button', { name: '确定', exact: true }), `periodic-charges/${batch}/confirm`, status);
}

for (const layout of [
  { name: '桌面', viewport: { width: 1440, height: 900 }, mobile: false },
  { name: '手机', viewport: { width: 390, height: 844 }, mobile: true },
]) {
  test.describe(layout.name, () => {
    test.use({
      viewport: layout.viewport, isMobile: layout.mobile, hasTouch: layout.mobile,
      deviceScaleFactor: layout.mobile ? 2 : 1, actionTimeout: 12_000,
    });
    test.setTimeout(85_000);
    test.beforeAll(assertMarkedPostgres);

    test('入住预览冲突后刷新，再确认实际入住、租约、应收和底数', async ({ page }) => {
      const access = await apiContext();
      try {
        const site = await building(access);
        const s = await subject(access, site, '入住');
        await loginAsAdmin(page);
        await page.goto('/rooms');
        expect(await page.evaluate(() => window.innerWidth)).toBe(layout.viewport.width);
        const dialog = await moveInPreview(page, s);
        await created(await access.req.patch(`rooms/${s.room.id}`, {
          headers: access.headers, data: { description: '核对房源版本', version: s.room.version },
        }), 200);
        await submission(page, dialog.getByRole('button', { name: '确认入住' }), `rooms/${s.room.id}/move-in`, 409);
        await expect(page.getByText('数据已存在或被其他操作改动，请刷新后重试', { exact: true })).toBeVisible();
        expect(ledger(s)).toMatchObject({
          room: { status: 'VACANT', version: s.room.version + 1 },
          lease: { status: 'DRAFT', tenantId: s.tenant.id, leaseConfirmedBy: null },
          bills: [], payments: 0, accounts: [], debits: [], readings: [], moveIns: 0,
        });

        await page.reload();
        const retry = await moveInPreview(page, s);
        const res = await submission(page, retry.getByRole('button', { name: '确认入住' }), `rooms/${s.room.id}/move-in`);
        const receipt = await res.json();
        await expect(retry).toBeHidden();
        await expect(page.getByText('入住办理完成', { exact: true })).toBeVisible();
        const result = ledger(s);
        expect(result).toMatchObject({
          room: { status: 'OCCUPIED', version: s.room.version + 2 },
          lease: { id: s.contract.id, tenantId: s.tenant.id, status: 'ACTIVE', leaseConfirmedBy: expect.any(String) },
          accounts: [{ id: receipt.prepayAccountId, tenantId: s.tenant.id, balanceCache: 0 }],
          readings: [{ id: receipt.baselines[0].readingId, currentReading: 100, settledAmount: 0 }],
          payments: 0, debits: [], moveIns: 1,
        });
        expect(result.bills.map((b) => [b.billType, b.amount, b.paidAmount, b.status, b.contractId])
          .sort(([left], [right]) => String(left).localeCompare(String(right)))).toEqual([
          ['DEPOSIT', 600000, 0, 'PENDING', s.contract.id], ['RENT', 300000, 0, 'PENDING', s.contract.id],
        ]);
      } finally {
        await access.req.dispose();
      }
    });

    test('周期收费部分执行后刷新，补账户并只重试阻断项', async ({ page }) => {
      const access = await apiContext();
      try {
        const site = await building(access);
        const good = await subject(access, site, '成功');
        const repair = await subject(access, site, '补办');
        await activateWithoutAccount(access, good);
        await activateWithoutAccount(access, repair);
        await ensurePrepayFunded(good.tenant.id, good.room.id, 200);
        await loginAsAdmin(page);
        await page.goto('/periodic-charges');
        expect(await page.evaluate(() => window.innerWidth)).toBe(layout.viewport.width);
        await selectBuilding(page, site);
        await page.getByRole('button', { name: '采集读数' }).click();
        const collection = page.getByRole('dialog', { name: '采集读数' });
        await expect(collection).toBeVisible();
        await collection.getByRole('spinbutton', { name: `${good.meter.meterNumber} 本次读数` }).fill('105');
        await collection.getByRole('spinbutton', { name: `${repair.meter.meterNumber} 本次读数` }).fill('104');
        await collection.getByRole('spinbutton', { name: `${repair.meter.meterNumber} 本次读数` }).press('Tab');
        await submission(page, collection.getByRole('button', { name: '只保存读数' }), 'periodic-charges/collect');
        await expect(collection.getByText('已保存', { exact: true })).toHaveCount(2);
        await collection.getByRole('button', { name: '关闭此对话框' }).click();

        const preview = await submission(page, page.getByRole('button', { name: '检查并预览' }), 'periodic-charges/preview');
        const { id, version } = await preview.json();
        await expect(page).toHaveURL(new RegExp(`batch=${id}`));
        const goodRow = page.getByRole('row').filter({ hasText: good.meter.meterNumber });
        const repairRow = page.getByRole('row').filter({ hasText: repair.meter.meterNumber });
        await expect(goodRow).toContainText('待确认');
        await expect(goodRow).toContainText('5.00');
        await expect(repairRow).toContainText('缺预付账户');
        const before = [ledger(good), ledger(repair)];
        expect(before.map((s) => [s.bills.map((b) => b.billType), s.debits.length, s.readings.at(-1)?.settledAmount]))
          .toEqual([[['RENT'], 0, null], [['RENT'], 0, null]]);

        // The real server rejects a stale version that another operator has rechecked.
        await created(await access.req.post(`periodic-charges/${id}/recheck`, {
          headers: access.headers, data: { version },
        }));
        await approveCharges(page, id, '5.00', 409);
        await expect(page.getByText('数据已存在或被其他操作改动，请刷新后重试', { exact: true })).toBeVisible();
        expect([ledger(good), ledger(repair)]).toEqual(before);
        await page.reload();
        await expect(goodRow).toContainText('待确认');
        await approveCharges(page, id, '5.00');
        await expect(goodRow).toContainText('已处理', { timeout: 30_000 });
        await expect(repairRow).toContainText('缺预付账户');
        const first = ledger(good);
        expect(first).toMatchObject({
          room: { status: 'OCCUPIED' }, lease: { tenantId: good.tenant.id }, payments: 0,
          accounts: [{ tenantId: good.tenant.id, balanceCache: 0 }],
          debits: [{ accountId: first.accounts[0].id, amount: -200, relatedId: first.readings[1].id }],
        });
        expect(first.bills.filter((b) => b.billType === 'UTILITY')).toMatchObject([
          { amount: 300, paidAmount: 0, contractId: good.contract.id, readingId: first.readings[1].id },
        ]);
        expect(ledger(repair)).toEqual(before[1]);

        await ensurePrepayFunded(repair.tenant.id, repair.room.id, 1000);
        await page.reload();
        await expect(goodRow).toContainText('已处理');
        await submission(page, page.getByRole('button', { name: '重新检查异常' }), `periodic-charges/${id}/recheck`);
        await expect(repairRow).toContainText('待确认');
        await approveCharges(page, id, '4.00');
        await expect(repairRow).toContainText('已处理', { timeout: 30_000 });
        expect(ledger(good)).toEqual(first);
        const second = ledger(repair);
        expect(second).toMatchObject({
          room: { status: 'OCCUPIED' }, lease: { tenantId: repair.tenant.id }, payments: 0,
          accounts: [{ tenantId: repair.tenant.id, balanceCache: 600 }],
          debits: [{ accountId: second.accounts[0].id, amount: -400, relatedId: second.readings[1].id }],
        });
        expect(second.bills.map((b) => [b.billType, b.contractId])).toEqual([['RENT', repair.contract.id]]);
        const rows = readBatch(id);
        expect(rows).toHaveLength(4);
        expect(rows).toEqual(expect.arrayContaining([
          expect.objectContaining({ targetId: good.contract.id, state: 'NO_CHANGE', attempts: 0 }),
          expect.objectContaining({ targetId: repair.contract.id, state: 'NO_CHANGE', attempts: 0 }),
          expect.objectContaining({ targetId: good.meter.id, state: 'SETTLED', attempts: 1, result: expect.objectContaining({ amount: 500 }) }),
          expect.objectContaining({ targetId: repair.meter.id, state: 'SETTLED', attempts: 1, result: expect.objectContaining({ amount: 400 }) }),
        ]));
      } finally {
        await access.req.dispose();
      }
    });
  });
}
