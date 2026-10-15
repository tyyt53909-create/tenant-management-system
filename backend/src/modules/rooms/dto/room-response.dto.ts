export class RoomResponseDto {
  id: string;
  roomNumber: string;
  buildingId: string;
  floor: number;
  area: number;
  bedrooms: number;
  bathrooms: number;
  hasBalcony: boolean;
  hasAirConditioner: boolean;
  hasWaterHeater: boolean;
  hasWifi: boolean;
  monthlyRent: number;
  deposit: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export class RoomDetailResponseDto extends RoomResponseDto {
  building?: {
    id: string;
    name: string;
    address: string;
  };
}

export class PaginatedRoomsResponseDto {
  data: RoomResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
