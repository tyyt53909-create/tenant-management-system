import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './fixtures';
import type { SpaceModelContract } from '../src/types/space';

const capabilities = {
  canSeeTenant: true,
  canSeeRent: true,
  canOperateStatus: true,
  canOperateCleaning: true,
};

function space(id: string, name: string, rentable: number, occupied: number, maintenance: number): SpaceModelContract {
  const rooms = [
    ...Array.from({ length: rentable }, (_, index) => ({
      id: `${id}-rentable-${index}`,
      roomNumber: `${index + 1}01`,
      floor: 1,
      shape: { kind: 'RECT' as const, x: (index % 4) * 4.85, y: Math.floor(index / 4) * 4.8, width: 4, depth: 3 },
      state: 'RENTABLE' as const,
      alerts: [],
      version: 1,
    })),
    ...Array.from({ length: occupied }, (_, index) => ({
      id: `${id}-occupied-${index}`,
      roomNumber: `O${index + 1}`,
      floor: 1,
      shape: { kind: 'RECT' as const, x: ((rentable + index) % 4) * 4.85, y: Math.floor((rentable + index) / 4) * 4.8, width: 4, depth: 3 },
      state: 'OCCUPIED' as const,
      alerts: [],
      version: 1,
    })),
    ...Array.from({ length: maintenance }, (_, index) => ({
      id: `${id}-maintenance-${index}`,
      roomNumber: `M${index + 1}`,
      floor: 1,
      shape: { kind: 'RECT' as const, x: ((rentable + occupied + index) % 4) * 4.85, y: Math.floor((rentable + occupied + index) / 4) * 4.8, width: 4, depth: 3 },
      state: 'MAINTENANCE' as const,
      alerts: [],
      version: 1,
    })),
  ];
  return {
    building: { id, name, floors: 2 },
    view: 'ADMIN',
    layoutMode: 'AUTO',
    capabilities,
    floors: [
      { floor: 2, level: 1, layoutMode: 'AUTO', width: 20, depth: 10, rooms: [] },
      { floor: 1, level: 0, layoutMode: 'AUTO', width: 20, depth: 10, rooms },
    ],
    summary: {
      total: rooms.length,
      occupied,
      reserved: 0,
      rentable,
      pendingClean: 0,
      cleaning: 0,
      maintenance,
      unknown: 0,
      occupancyRate: rooms.length ? (occupied / rooms.length) * 100 : 0,
      rentableRate: rooms.length ? (rentable / rooms.length) * 100 : 0,
    },
    generatedAt: '2026-10-21T00:00:00.000Z',
  };
}

test.describe('小区模型', () => {
  test.use({ viewport: { width: 878, height: 658 } });

  test('多栋楼显示小区模型，点击楼栋进入 2D 楼层', async ({ page }) => {
    await loginAsAdmin(page);
    await page.route('**/api/buildings?page=1&limit=100', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'b1', name: '栖居一栋', floors: 2, isActive: true, address: 'A' },
            { id: 'b2', name: '栖居二栋', floors: 2, isActive: true, address: 'B' },
          ],
          meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
        }),
      }),
    );
    await page.route('**/api/buildings/b1/space', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(space('b1', '栖居一栋', 8, 4, 0)) }),
    );
    await page.route('**/api/buildings/b2/space', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(space('b2', '栖居二栋', 0, 4, 5)) }),
    );

    await page.goto('/space');
    await expect(page.locator('.campus-scene')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.campus-building-label')).toHaveCount(2);
    await expect(page.getByText('小区总览')).toBeVisible();

    await page.getByRole('button', { name: /栖居一栋/ }).click();
    await expect(page.locator('.space-summary')).toBeVisible();
    await expect(page.getByRole('button', { name: '2D 楼层' })).toHaveClass(/active/);
    await expect(page.locator('.floor-card')).toHaveCount(2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
