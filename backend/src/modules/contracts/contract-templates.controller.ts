import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContractTemplatesService } from './contract-templates.service.js';
import {
  CreateContractTemplateDto,
  UpdateContractTemplateDto,
  QueryContractTemplatesDto,
} from './dto/contract-template.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('contract-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractTemplatesController {
  constructor(private readonly templatesService: ContractTemplatesService) {}

  @Get()
  @Roles('ADMIN')
  findAll(@Query() query: QueryContractTemplatesDto) {
    return this.templatesService.findAll(query);
  }

  @Get('default')
  @Roles('ADMIN', 'TENANT')
  findDefault() {
    return this.templatesService.findDefault();
  }

  @Get(':id')
  @Roles('ADMIN', 'TENANT')
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @Body() dto: CreateContractTemplateDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.templatesService.create(dto, user.userId);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateContractTemplateDto) {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.templatesService.remove(id);
  }
}
