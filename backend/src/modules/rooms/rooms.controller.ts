import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { RoomsService } from './rooms.service.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { UpdateRoomDto } from './dto/update-room.dto.js';
import { UpdateRoomStatusDto } from './dto/update-room-status.dto.js';
import { MarkCleanDto } from './dto/mark-clean.dto.js';
import { QueryRoomsDto } from './dto/query-rooms.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @Get()
  findAll(@Request() req: any, @Query() query: QueryRoomsDto) {
    // 保洁仅可见待清洁房间（服务端固定过滤，docs/03-权限矩阵.md）
    return this.roomsService.findAll(query, req.user?.role);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.roomsService.findOne(id, req.user?.role);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'CLEANER')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateRoomStatusDto) {
    return this.roomsService.updateStatus(id, dto);
  }

  // 标记已清洁（保洁/管理员，docs/05-接口规范.md §8.2）
  @Patch(':id/clean')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'CLEANER')
  markClean(@Param('id') id: string, @Body() dto: MarkCleanDto) {
    return this.roomsService.markClean(id, dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() updateRoomDto: UpdateRoomDto) {
    return this.roomsService.update(id, updateRoomDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }
}
