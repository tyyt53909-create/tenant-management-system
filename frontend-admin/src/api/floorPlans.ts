import request from '@/utils/request';

export interface FloorPlanShapeResponse {
  id: string;
  roomId: string | null;
  kind: 'RECT' | 'POLYGON';
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation?: number;
  polygon?: [number, number][] | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SaveFloorPlanShape {
  roomId: string | null;
  kind: 'RECT' | 'POLYGON';
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation?: number;
  polygon?: [number, number][] | null;
}

/** Explicitly project response geometry onto the whitelisted save DTO shape. */
export const toSaveFloorPlanShape = (shape: FloorPlanShapeResponse): SaveFloorPlanShape => ({
  roomId: shape.roomId,
  kind: shape.kind,
  x: shape.x,
  y: shape.y,
  width: shape.width,
  depth: shape.depth,
  rotation: shape.rotation,
  polygon: shape.polygon,
});

export interface FloorPlan {
  id: string;
  buildingId: string;
  floor: number;
  width: number;
  depth: number;
  backgroundUrl?: string | null;
  version: number;
  shapes: FloorPlanShapeResponse[];
}

export interface SaveFloorPlanPayload {
  width: number;
  depth: number;
  version: number;
  backgroundUrl?: string | null;
  shapes: SaveFloorPlanShape[];
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
