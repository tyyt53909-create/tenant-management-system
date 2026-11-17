import { ApiCreatedResponse } from '@nestjs/swagger';
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ConfirmMoveInDto, MoveInLeaseDto, MoveInPreviewDto, MoveInResultDto } from './dto/move-in.dto.js';
import { MoveInsService } from './move-ins.service.js';

@Controller('rooms/:roomId/move-in')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MoveInsController {
  constructor(private readonly moveIns: MoveInsService) {}

  @Post('preview')
  @ApiCreatedResponse({ type: MoveInPreviewDto })
  preview(@Param('roomId') roomId: string, @Body() dto: MoveInLeaseDto) {
    return this.moveIns.preview(roomId, dto);
  }

  @Post()
  @ApiCreatedResponse({ type: MoveInResultDto })
  confirm(@Param('roomId') roomId: string, @Body() dto: ConfirmMoveInDto, @CurrentUser() auth: CurrentUserParam) {
    return this.moveIns.confirm(roomId, dto, resolveAuthUser(auth).userId);
  }
}
