import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';
import { CreateStaffDto, QueryStaffDto, ResetStaffPasswordDto, UpdateStaffDto } from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

@Controller('staff')
@Roles('ADMIN')
export class StaffController {
  constructor(private readonly staff: StaffService) {}
  @Get() list(@Query() query: QueryStaffDto) { return this.staff.list(query); }
  @Post() create(@Body() dto: CreateStaffDto) { return this.staff.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @CurrentUser() current: CurrentUserParam, @Body() dto: UpdateStaffDto) {
    return this.staff.update(id, resolveAuthUser(current).userId, dto);
  }
  @Post(':id/reset-password') resetPassword(@Param('id') id: string, @Body() dto: ResetStaffPasswordDto) {
    return this.staff.resetPassword(id, dto);
  }
}
