import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SettingsService } from './settings.service.js';
import { UpdateSettingDto } from './dto/update-setting.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  resolveAuthUser,
  type CurrentUserParam,
} from '../../common/decorators/current-user.decorator.js';

/** 业务设置中心（FIN-11 / T276）：仅 ADMIN，读写均需鉴权。 */
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  list() {
    return this.settingsService.list();
  }

  @Get(':key')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getOne(@Param('key') key: string) {
    return this.settingsService.getOne(key);
  }

  @Patch(':key')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @Req() request: Request,
  ) {
    const user = resolveAuthUser(userParam);
    return this.settingsService.update(key, dto.value, {
      userId: user.userId,
      ip: request.ip ?? '',
      userAgent: request.headers['user-agent'] ?? '',
    });
  }
}
