import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { QueryNotificationsDto } from './dto/query-notifications.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Get()
  findAll(@CurrentUser() userParam: CurrentUserParam, @Query() query: QueryNotificationsDto) {
    const user = resolveAuthUser(userParam);
    return this.notificationsService.findAll(user.userId, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    return this.notificationsService.unreadCount(user.userId);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    return this.notificationsService.markAllRead(user.userId);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    return this.notificationsService.markRead(id, user.userId);
  }

  @Delete(':id')
  remove(@CurrentUser() userParam: CurrentUserParam, @Param('id') id: string) {
    const user = resolveAuthUser(userParam);
    return this.notificationsService.remove(id, user.userId);
  }
}
