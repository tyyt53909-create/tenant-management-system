export class BillResponseDto {
  id: string;
  contractId: string;
  billNumber: string;
  billType: string;
  period: string;
  amount: number;
  paidAmount: number;
  snapshot: any;
  dueDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export class PaginatedBillsResponseDto {
  data: BillResponseDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
