export class TenantResponseDto {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  tags: Record<string, unknown> | unknown[] | null;
  notes: string | null;
  isActive: boolean;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedTenantsResponseDto {
  data: TenantResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
