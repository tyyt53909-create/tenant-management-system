import request from '@/utils/request';

export interface DashboardStats {
  totalRooms: number;
  totalTenants: number;
  activeContracts: number;
  pendingBills: number;
  vacantRooms: number;
  occupiedRooms: number;
  maintenanceRequests: number;
}

export interface RevenueData {
  month: string;
  revenue: number;
}

export interface RoomStatusData {
  status: string;
  count: number;
}

// 获取仪表板统计数据
export const getDashboardStats = (): Promise<DashboardStats> => {
  return request.get('/dashboard/stats');
};

// 获取收入趋势数据
export const getRevenueTrend = (months: number = 6): Promise<RevenueData[]> => {
  return request.get('/dashboard/revenue-trend', { params: { months } });
};

// 获取房源状态分布
export const getRoomStatusDistribution = (): Promise<RoomStatusData[]> => {
  return request.get('/dashboard/room-status');
};
