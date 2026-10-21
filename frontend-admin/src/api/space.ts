import request from '@/utils/request';
import type { SpaceModelContract } from '@/types/space';

/** 取得一棟樓的角色投影空間模型（T222）。 */
export const getBuildingSpace = (buildingId: string): Promise<SpaceModelContract> => {
  return request.get(`/buildings/${encodeURIComponent(buildingId)}/space`);
};
