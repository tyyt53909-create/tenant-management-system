import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service.js';
import { QueryAppointmentsDto } from './dto/query-appointments.dto.js';
import {
  ConfirmAppointmentDto,
  CompleteAppointmentDto,
  CancelAppointmentDto,
} from './dto/update-appointment.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  /** 管理端查询预约列表 */
  @Get()
  @Roles('ADMIN')
  findAll(@Query() query: QueryAppointmentsDto) {
    return this.appointmentsService.findAll(query);
  }

  /** 租客/访客查询本人看房预约记录 */
  @Get('my')
  @Roles('TENANT', 'ADMIN')
  findMy(@CurrentUser() userParam: CurrentUserParam) {
    const user = resolveAuthUser(userParam);
    return this.appointmentsService.findMy(user.userId);
  }

  /** 预约详情 */
  @Get(':id')
  @Roles('ADMIN', 'TENANT')
  findOne(@Param('id') id: string) {
    return this.appointmentsService.findOne(id);
  }

  /** 管理员确认看房排期 */
  @Patch(':id/confirm')
  @Roles('ADMIN')
  confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmAppointmentDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.appointmentsService.confirm(id, dto, user.userId);
  }

  /** 标记看房已完成并填写反馈 */
  @Patch(':id/complete')
  @Roles('ADMIN')
  complete(@Param('id') id: string, @Body() dto: CompleteAppointmentDto) {
    return this.appointmentsService.complete(id, dto);
  }

  /** 取消预约（租客或管理员） */
  @Patch(':id/cancel')
  @Roles('ADMIN', 'TENANT')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.appointmentsService.cancel(id, dto, user.userId, user.role, user.userId);
  }
}
