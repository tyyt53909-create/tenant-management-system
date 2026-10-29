import { test, expect } from '@playwright/test';

test('租金报表区分待核对与完整月份，并防止重复查询显示旧结果', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body: object = {};
    if (url.pathname.endsWith('/auth/refresh')) body = { accessToken: 'synthetic-token' };
    else if (url.pathname.endsWith('/auth/me')) body = { id: 'synthetic-user', role: 'ADMIN', email: 'test@example.invalid' };
    else if (url.pathname.endsWith('/buildings')) body = { data: [{ id: 'synthetic-building', name: '测试楼栋' }] };
    else if (url.pathname.endsWith('/statistics/overview')) body = { dimension: 'BUILDING', byFloor: [], summary: { range: { start: '2026-03-01', end: '2026-03-31' }, totalBilled: 0, rentBilled: 0, utilityBilled: 0, totalPaid: 0, rentPaid: 0, utilityPaid: 0, collectionRate: null, roomOccupied: 0, roomTotal: 0, occupancyRate: 0, overdueCount: 0, maintenanceCount: 0 } };
    else if (url.pathname.endsWith('/statistics/rent-report')) {
      requests++;
      await new Promise(resolve => setTimeout(resolve, 150));
      body = { month: '2026-03', buildingId: 'synthetic-building', status: 'incomplete', rentIncome: null, netOperatingIncome: null, verifiedAllocationRentSubtotal: 60000, verifiedRefundSubtotal: 10000, verifiedCorrectionSubtotal: 0, unknownAllocationCount: 1, unknownAdjustmentCount: 0, paidExpenses: 5000, currentPrepayBalance: 40000, basis: '合成测试口径', limitations: ['测试警示'], hasRentAdjustments: true };
      if (url.searchParams.get('month')?.endsWith('-04')) body = { ...body, status: 'complete', rentIncome: -5000, netOperatingIncome: -10000, unknownAllocationCount: 0, verifiedCorrectionSubtotal: 5000 };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/statistics');
  await page.getByRole('heading', { name: '租金收支管理报表' }).waitFor();
  await page.locator('.rent-report .el-select').click();
  await page.getByText('测试楼栋', { exact: true }).last().click();
  const date = page.getByPlaceholder('选择月份');
  await date.click();
  await page.locator('.el-month-table td').nth(2).click();
  await page.getByRole('button', { name: '查询收支' }).click();
  await expect(page.locator('.rent-report')).toContainText('数据待核对');
  await expect(page.locator('.rent-report')).toContainText('待核对');
  await expect(page.locator('.rent-report')).toContainText('600.00');
  await expect(page.locator('.rent-report')).toContainText('100.00');
  await date.click();
  await page.locator('.el-month-table td').nth(3).click();
  await expect(page.getByText('租金净收入', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '查询收支' }).dblclick({ delay: 20 });
  await expect(page.locator('.rent-report')).toContainText('-50.00');
  await expect(page.locator('.rent-report')).toContainText('-100.00');
  await expect(page.locator('.rent-report')).not.toContainText('数据待核对');
  expect(requests).toBe(2);
});
