import { test, expect } from '@playwright/test';
import { ADMIN, loginAsAdmin, uid } from './fixtures';

/** 1×1 透明 PNG：最小合法图片，用于触发上传与缩略图流程。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * 流程：新增房源上传照片 → 详情显示 → 编辑时删除/排序 → 保存后顺序持久化。
 * 数据清理走 API，避免测试房源残留；照片不再阻断删除（T230）。
 */
test('房源新增与编辑可上传、排序、删除照片', async ({ page, request }) => {
  const roomNumber = `PWPH${uid()}`.slice(0, 12).toUpperCase();
  let roomId = '';

  try {
    await loginAsAdmin(page);
    await page.goto('/rooms');

    await page.getByRole('button', { name: /新增房源/ }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: '新增房源' });
    await dialog.getByPlaceholder('请输入房间号').fill(roomNumber);
    await dialog
      .locator('.el-form-item')
      .filter({ hasText: '楼层' })
      .locator('input')
      .fill('98');
    await dialog
      .locator('.el-form-item')
      .filter({ hasText: '房型' })
      .locator('.el-select__wrapper')
      .click();
    await page.locator('.el-select-dropdown__item').filter({ hasText: '单间' }).click();
    await dialog
      .locator('.el-form-item')
      .filter({ hasText: '面积' })
      .locator('input')
      .fill('20');

    const fileInput = dialog.locator('.room-photo-editor input[type=file]');
    await fileInput.setInputFiles({ name: 'room-1.png', mimeType: 'image/png', buffer: PNG });
    await expect(dialog.locator('.photo-tile')).toHaveCount(1, { timeout: 15000 });
    await expect(dialog.locator('.photo-cover')).toHaveText('封面');

    await dialog.getByRole('button', { name: '确定' }).click();
    await expect(page.locator('.el-message--success').filter({ hasText: '创建成功' })).toBeVisible();
    await expect(dialog).toBeHidden();

    const row = page.locator('.el-table__row').filter({ hasText: roomNumber });
    await expect(row).toHaveCount(1, { timeout: 10000 });
    await row.getByRole('button', { name: '详情' }).click();
    const detail = page.locator('.property-pane-layout');
    await expect(detail.locator('.pane-photo-controls')).toContainText('1 / 1', { timeout: 15000 });

    // 读取 API 中的房源 id，供编辑后的顺序断言与清理使用。
    const login = await request.post('/api/auth/login', { data: ADMIN });
    const { accessToken } = await login.json();
    const headers = { Authorization: `Bearer ${accessToken}` };
    const rooms = await request.get('/api/rooms?limit=100', { headers });
    roomId = (await rooms.json()).data.find((room: { roomNumber: string }) => room.roomNumber === roomNumber).id;

    await detail.getByRole('button', { name: '编辑房源' }).click();
    const editDialog = page.getByRole('dialog').filter({ hasText: '编辑房源' });
    await expect(editDialog.locator('.photo-tile')).toHaveCount(1, { timeout: 15000 });

    await editDialog.locator('.room-photo-editor input[type=file]').setInputFiles({
      name: 'room-2.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(editDialog.locator('.photo-tile')).toHaveCount(2, { timeout: 15000 });

    // 第二张前移为封面，再删除原封面。
    await editDialog.getByRole('button', { name: '把照片 2 前移' }).click();
    await editDialog.getByRole('button', { name: '删除照片 2' }).click();
    await expect(editDialog.locator('.photo-tile')).toHaveCount(1);

    await editDialog.getByRole('button', { name: '确定' }).click();
    await expect(page.locator('.el-message--success').filter({ hasText: '更新成功' })).toBeVisible();

    const saved = await (await request.get(`/api/rooms/${roomId}`, { headers })).json();
    expect(saved.photos).toHaveLength(1);
    expect(saved.photos[0].sortOrder).toBe(0);

    await detail.getByRole('button', { name: '关闭详情面板' }).click();
  } finally {
    if (roomId) {
      const login = await request.post('/api/auth/login', { data: ADMIN });
      const { accessToken } = await login.json();
      await request.delete(`/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
  }
});
