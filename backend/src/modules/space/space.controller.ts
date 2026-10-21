import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { SpaceService } from './space.service.js';

@Controller('buildings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  @Get(':id/space')
  @Roles('ADMIN', 'CLEANER', 'TENANT')
  getSpace(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserParam) {
    const user = resolveAuthUser(currentUser);
    return this.spaceService.getBuildingSpace(id, user.role, user.tenantId);
  }
}

@Controller('public/buildings')
export class PublicSpaceController {
  constructor(private readonly spaceService: SpaceService) {}

  @Get(':id/space')
  getSpace(@Param('id') id: string) { return this.spaceService.getBuildingSpace(id, 'PUBLIC'); }
}
