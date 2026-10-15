import { Controller, Get, Param, Query } from '@nestjs/common';
import { PublicService } from './public.service.js';
import { QueryPublicRoomsDto } from './dto/query-public-rooms.dto.js';

/**
 * 公开看房接口（P1 / T155）—— **无需登录**。
 *
 * 只读、只暴露可出租房源，绝不包含租客信息。路由置于 /public 前缀下，
 * 便于在网关或反代层单独限流。
 */
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  /** 可租楼栋列表 */
  @Get('buildings')
  listBuildings() {
    return this.publicService.listBuildings();
  }

  /** 可租房源列表 */
  @Get('rooms')
  listRooms(@Query() query: QueryPublicRoomsDto) {
    return this.publicService.listRooms(query);
  }

  /** 可租房源详情（不可租/不存在均 404） */
  @Get('rooms/:id')
  getRoom(@Param('id') id: string) {
    return this.publicService.getRoom(id);
  }
}
