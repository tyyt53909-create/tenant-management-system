import request from '@/utils/request';

export type StatisticsPeriod = 'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';
export type StatisticsDimension = 'BUILDING' | 'FLOOR';

export interface StatisticsSummary {
  range: { start: string; end: string };
  period: StatisticsPeriod;
  rentBilled: number;
  rentPaid: number;
  utilityBilled: number;
  utilityPaid: number;
  totalBilled: number;
  totalPaid: number;
  /** 收缴率（百分比，无账单时为 null） */
  collectionRate: number | null;
  overdueCount: number;
  maintenanceCount: number;
  roomTotal: number;
  roomOccupied: number;
  occupancyRate: number;
}

export interface FloorStatistics {
  floor: number;
  roomTotal: number;
  roomOccupied: number;
  occupancyRate: number;
}

export interface StatisticsOverview {
  summary: StatisticsSummary;
  dimension: StatisticsDimension;
  byFloor: FloorStatistics[];
}

export const getStatisticsOverview = (params: {
  period?: StatisticsPeriod;
  dimension?: StatisticsDimension;
  startDate?: string;
  endDate?: string;
  buildingId?: string;
}): Promise<StatisticsOverview> => {
  return request.get('/statistics/overview', { params });
};

export const getBuildingsForFilter = (): Promise<{ id: string; name: string }[]> => {
  return request.get('/buildings', { params: { page: 1, limit: 100 } }).then((res: any) => res.data);
};
