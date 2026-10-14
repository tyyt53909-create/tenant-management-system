import { Controller,Get,Request,UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ManagementSummaryService } from './management-summary.service.js';

@Controller('dashboard')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('ADMIN')
export class ManagementSummaryController {
  constructor(private readonly summary:ManagementSummaryService) {}
  @Get('management-summary')
  snapshot(@Request() request:any){return this.summary.snapshot(request.user?.userId);}
}
