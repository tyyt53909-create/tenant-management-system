import request from '@/utils/request';
import type { Room, RoomStatus, PaginatedResponse } from '@/types';

/**
 * GET /rooms 支持的查询参数（后端 QueryRoomsDto）。
 * 后端启用 ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })：
 * 传入未声明字段或空字符串都会返回 400，因此这里做白名单 + 空值过滤。
 * 注意：cleanStatus 不是后端查询参数，清洁状态筛选需前端本地过滤。
 */
export interface RoomsQuery {
  page?: number;
  limit?: number;
  status?: RoomStatus;
  buildingId?: string;
  minRent?: number;
  maxRent?: number;
}

const ROOMS_QUERY_KEYS: (keyof RoomsQuery)[] = [
  'page',
  'limit',
  'status',
  'buildingId',
  'minRent',
  'maxRent',
];

/** 白名单 + 去空值，避免后端 forbidNonWhitelisted / 空字符串校验返回 400 */
export const toRoomsQuery = (params: RoomsQuery = {}): Record<string, string | number> => {
  const query: Record<string, string | number> = {};
  for (const key of ROOMS_QUERY_KEYS) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    query[key] = value;
  }
  return query;
};

// 获取房源列表
export const getRooms = (params: RoomsQuery = {}): Promise<PaginatedResponse<Room>> => {
  return request.get('/rooms', { params: toRoomsQuery(params) });
};

// 获取房源详情
export const getRoomById = (id: string): Promise<Room> => {
  return request.get(`/rooms/${id}`);
};

// 创建房源
export const createRoom = (data: Partial<Room>) => {
  return request.post('/rooms', data);
};

// 更新房源
export const updateRoom = (id: string, data: Partial<Room>) => {
  return request.patch(`/rooms/${id}`, data);
};

// 删除房源
export const deleteRoom = (id: string) => {
  return request.delete(`/rooms/${id}`);
};

// 房态流转（乐观锁：version 必填，冲突返回 409）
export const updateRoomStatus = (
  id: string,
  data: { status?: RoomStatus; cleanStatus?: string; version: number }
) => {
  return request.patch(`/rooms/${id}/status`, data);
};

// 标记已清洁（VACANT+CLEANING → VACANT+CLEAN，后端 PATCH /rooms/:id/clean）
export const markRoomClean = (id: string, data: { version?: number } = {}) => {
  return request.patch(`/rooms/${id}/clean`, data);
};

/** 单页拉取条数（后端 limit 上限 100） */
const ALL_ROOMS_PAGE_SIZE = 100;
/** 最多拉取页数，防止数据量异常时无限循环 */
const ALL_ROOMS_MAX_PAGES = 20;
/** 一次最多加载的房源数 */
export const ALL_ROOMS_LIMIT = ALL_ROOMS_PAGE_SIZE * ALL_ROOMS_MAX_PAGES;

export interface AllRoomsResult {
  data: Room[];
  /** 后端报告的总数 */
  total: number;
  /** 是否因为超过上限而未加载完整 */
  truncated: boolean;
}

/**
 * 分页拉取全部房源。
 * 后端 GET /rooms 只支持 page/limit/status/buildingId，无法按 cleanStatus 过滤，
 * 因此保洁相关视图需先加载全量再本地筛选（数量超过 ALL_ROOMS_LIMIT 时截断并标记）。
 */
export const fetchAllRooms = async (
  filter: Pick<RoomsQuery, 'status' | 'buildingId'> = {}
): Promise<AllRoomsResult> => {
  const collected: Room[] = [];
  let total = 0;
  let truncated = false;

  for (let page = 1; page <= ALL_ROOMS_MAX_PAGES; page += 1) {
    const response = await getRooms({ ...filter, page, limit: ALL_ROOMS_PAGE_SIZE });
    const batch = response.data ?? [];
    collected.push(...batch);
    total = response.meta?.total ?? collected.length;

    if (batch.length === 0 || collected.length >= total) break;
    if (page === ALL_ROOMS_MAX_PAGES) truncated = collected.length < total;
  }

  return { data: collected, total, truncated };
};
