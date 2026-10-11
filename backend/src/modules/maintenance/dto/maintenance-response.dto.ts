export class MaintenanceResponseDto {
  id: string;
  roomId: string;
  tenantId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  assignedAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedMaintenanceResponseDto {
  data: MaintenanceResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
