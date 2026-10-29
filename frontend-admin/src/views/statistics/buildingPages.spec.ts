import { expect, it, vi } from 'vitest';
import { fetchBuildingPage } from './buildingPages';
it('第二页提供第 101 栋，失败明确传播供重试', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [{ id: '101', name: '第101栋' }], meta: { totalPages: 2 } });
  await expect(fetchBuildingPage(fetcher, 2)).rejects.toThrow('offline');
  expect((await fetchBuildingPage(fetcher, 2)).data[0].id).toBe('101');
  expect(fetcher).toHaveBeenCalledWith(2);
});
it('拒绝不完整响应，避免默默显示空列表', async () => {
  await expect(fetchBuildingPage(async () => ({ data: [], meta: {} } as never), 1)).rejects.toThrow('invalid building page');
});
