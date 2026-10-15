import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { QueryNotificationsDto } from './dto/query-notifications.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

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
  findAll(@Request() req: any, @Query() query: QueryNotificationsDto) {
    return this.notificationsService.findAll(req.user.userId, query);
  }

  @Get('unread-count')
  unreadCount(@Request() req: any) {
    return this.notificationsService.unreadCount(req.user.userId);
  }

  @Patch('read-all')
  markAllRead(@Request() req: any) {
    return this.notificationsService.markAllRead(req.user.userId);
  }

  @Patch(':id/read')
  markRead(@Request() req: any, @Param('id') id: string) {
    return this.notificationsService.markRead(id, req.user.userId);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.notificationsService.remove(id, req.user.userId);
  }
}
