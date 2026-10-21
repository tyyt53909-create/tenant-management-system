import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('@/utils/request', () => ({ default: { get, post, put } }));

import { createFloorPlanTemplate, getFloorPlans, saveFloorPlan } from './floorPlans';

describe('floorPlans API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads plans for an encoded building id', async () => {
    get.mockResolvedValue([]);
    await expect(getFloorPlans('building/one')).resolves.toEqual([]);
    expect(get).toHaveBeenCalledWith('/buildings/building%2Fone/floor-plans');
  });

  it('saves authored shapes with optimistic-lock version', async () => {
    const payload = { width: 240, depth: 160, version: 3, shapes: [{ roomId: 'r1', kind: 'RECT' as const, x: 20, y: 0, width: 100, depth: 80 }] };
    put.mockResolvedValue({ ...payload, id: 'p1', buildingId: 'b1', floor: 2 });
    await saveFloorPlan('b1', 2, payload);
    expect(put).toHaveBeenCalledWith('/buildings/b1/floor-plans/2', payload);
  });

  it('requests a template for the selected floor', async () => {
    post.mockResolvedValue({ id: 'p1', floor: 4, version: 1, shapes: [{ roomId: 'r1' }] });
    const result = await createFloorPlanTemplate('b1', 4);
    expect(post).toHaveBeenCalledWith('/buildings/b1/floor-plans/4/template');
    expect(result.shapes).toHaveLength(1);
  });
});
