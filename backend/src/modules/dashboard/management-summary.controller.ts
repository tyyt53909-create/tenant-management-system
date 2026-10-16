import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ManagementSummaryService } from './management-summary.service.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ManagementSummaryController {
  constructor(private readonly summary: ManagementSummaryService) {}

  @Get('management-summary')
  snapshot(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    return this.summary.snapshot(user.userId);
  }
}
