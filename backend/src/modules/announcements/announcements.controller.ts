import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service.js';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto.js';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

/**
 * 公告与定向消息（COM-04 / T284）。
 *
 * 仅 ADMIN：租客通过通知中心接收公告（投递后就是普通站内通知），
 * 不需要也不允许直接读公告表，避免绕过通知已读状态。
 */
@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  findAll(@Query() query: QueryAnnouncementsDto) {
    return this.announcementsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.announcementsService.findOne(id);
  }

  @Post()
  create(@CurrentUser() userParam: CurrentUserParam, @Body() dto: CreateAnnouncementDto) {
    const user = resolveAuthUser(userParam);
    return this.announcementsService.create(dto, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcementsService.update(id, dto);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.announcementsService.publish(id);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.announcementsService.archive(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.announcementsService.remove(id);
  }
}
