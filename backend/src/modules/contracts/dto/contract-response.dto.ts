export class ContractResponseDto {
  id: string;
  buildingId: string;
  roomId: string;
  tenantId: string;
  contractNumber: string;
  rentAmount: number;
  depositAmount: number;
  paymentCycle: string;
  paymentDay: number;
  startDate: Date;
  endDate: Date;
  lateFeeRule: Record<string, unknown>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedContractsResponseDto {
  data: ContractResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
