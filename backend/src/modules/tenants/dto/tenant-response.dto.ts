export class TenantResponseDto {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  /** 标签（T215）：按字典 sort、名称排序 */
  tags: { id: string; name: string }[];
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
