import { ApiProperty } from '@nestjs/swagger';

export class RoomStatusSnapshotDto {
  @ApiProperty() id!: string;
  @ApiProperty() buildingId!: string;
  @ApiProperty({ type: String, format: 'date-time', description: '业务日期（数据库 date 的 UTC 零点）' }) businessDate!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) capturedAt!: Date;
  @ApiProperty() total!: number;
  @ApiProperty() vacant!: number;
  @ApiProperty() reserved!: number;
  @ApiProperty() occupied!: number;
  @ApiProperty() maintenance!: number;
}

export class RoomStatusHistoryDto {
  @ApiProperty({ type: RoomStatusSnapshotDto, nullable: true }) snapshot!: RoomStatusSnapshotDto | null;
}
