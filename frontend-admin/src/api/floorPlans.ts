import request from '@/utils/request';

export interface FloorPlanShape {
  id?: string;
  roomId: string | null;
  kind: 'RECT' | 'POLYGON';
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation?: number;
  polygon?: [number, number][] | null;
}

export interface FloorPlan {
  id: string;
  buildingId: string;
  floor: number;
  width: number;
  depth: number;
  backgroundUrl?: string | null;
  version: number;
  shapes: FloorPlanShape[];
}

export interface SaveFloorPlanPayload {
  width: number;
  depth: number;
  version: number;
  backgroundUrl?: string | null;
  shapes: FloorPlanShape[];
}

export const getFloorPlans = (buildingId: string): Promise<FloorPlan[]> =>
  request.get(`/buildings/${encodeURIComponent(buildingId)}/floor-plans`);

export const saveFloorPlan = (
  buildingId: string,
  floor: number,
  payload: SaveFloorPlanPayload,
): Promise<FloorPlan> =>
  request.put(`/buildings/${encodeURIComponent(buildingId)}/floor-plans/${floor}`, payload);

export const createFloorPlanTemplate = (buildingId: string, floor: number): Promise<FloorPlan> =>
  request.post(`/buildings/${encodeURIComponent(buildingId)}/floor-plans/${floor}/template`);
