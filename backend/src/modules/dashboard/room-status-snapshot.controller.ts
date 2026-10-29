import { ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { RoomStatusHistoryDto, RoomStatusSnapshotDto } from './room-status-snapshot.dto.js';
import { RoomStatusSnapshotService } from './room-status-snapshot.service.js';

@Controller('dashboard/room-status-history')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class RoomStatusSnapshotController {
  constructor(private readonly snapshots: RoomStatusSnapshotService) {}

  @Post(':buildingId/capture')
  @ApiOperation({ summary: '捕获当前业务日的房态；同日重试返回原快照' })
  @ApiResponse({ status: 201, description: '房态快照；只允许管理员', type: RoomStatusSnapshotDto })
  capture(@Param('buildingId') buildingId: string, @Body() body: unknown, @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length > 0 || (body && (typeof body !== 'object' || Object.keys(body).length > 0))) throw new BadRequestException('捕获只支持当前业务日');
    return this.snapshots.capture(buildingId);
  }

  @Get(':buildingId')
  @ApiOperation({ summary: '读取指定业务日房态；缺日返回 snapshot: null' })
  @ApiQuery({ name: 'date', required: true, example: '2026-10-29' })
  @ApiResponse({ status: 200, description: '包含 snapshot 的对象；未捕获时 snapshot 为 null', type: RoomStatusHistoryDto })
  async get(@Param('buildingId') buildingId: string, @Query('date') date: string) {
    return { snapshot: await this.snapshots.get(buildingId, date) };
  }
}
