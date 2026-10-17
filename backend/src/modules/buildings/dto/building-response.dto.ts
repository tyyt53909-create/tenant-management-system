export class BuildingResponseDto {
  id: string;
  name: string;
  address: string | null;
  floors: number;
  metadata: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedBuildingsResponseDto {
  data: BuildingResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
