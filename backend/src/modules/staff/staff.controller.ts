import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import {
  CurrentUser,
  resolveAuthUser,
  type CurrentUserParam,
} from '../../common/decorators/current-user.decorator.js';
import {
  CreateStaffDto,
  QueryStaffDto,
  ResetStaffPasswordDto,
  UpdateStaffDto,
  AssignStaffBuildingsDto,
} from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: QueryStaffDto) {
    return this.staff.list(query);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateStaffDto, @CurrentUser() current: CurrentUserParam) {
    return this.staff.create(dto, resolveAuthUser(current).userId);
  }

  /** 当前登录员工查看自己负责管辖的楼栋列表（DEC-08 / WRK-01） */
  @Get('me/buildings')
  @Roles('ADMIN', 'PROPERTY_MANAGER', 'FINANCIAL', 'MAINTAINER', 'CLEANER', 'OWNER')
  getMyBuildings(@CurrentUser() current: CurrentUserParam) {
    const user = resolveAuthUser(current);
    return this.staff.getMyBuildings(user.userId, user.role);
  }

  @Get(':id')
  @Roles('ADMIN')
  findOne(@Param('id') id: string) {
    return this.staff.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @CurrentUser() current: CurrentUserParam,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staff.update(id, resolveAuthUser(current).userId, dto);
  }

  @Post(':id/reset-password')
  @Roles('ADMIN')
  resetPassword(@Param('id') id: string, @Body() dto: ResetStaffPasswordDto) {
    return this.staff.resetPassword(id, dto);
  }

  /** 为员工指派/调整负责管辖楼栋（DEC-08 / WRK-01） */
  @Post(':id/buildings')
  @Roles('ADMIN')
  assignBuildings(
    @Param('id') id: string,
    @Body() dto: AssignStaffBuildingsDto,
    @CurrentUser() current: CurrentUserParam,
  ) {
    return this.staff.assignBuildings(id, dto, resolveAuthUser(current).userId);
  }

  /** 查看某员工负责管辖的楼栋列表 */
  @Get(':id/buildings')
  @Roles('ADMIN')
  getAssignedBuildings(@Param('id') id: string) {
    return this.staff.getAssignedBuildings(id);
  }
}
