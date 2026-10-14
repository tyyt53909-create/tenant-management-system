import { Controller,Get,Query,UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { ManagementSearchService } from './management-search.service.js';
import { ManagementSearchDto } from './dto/management-search.dto.js';
@Controller('dashboard')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('ADMIN')
export class ManagementSearchController {
  constructor(private readonly searchService:ManagementSearchService) {}
  @Get('search')
  search(@Query() query:ManagementSearchDto){return this.searchService.search(query.q);}
}
