import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CleaningService } from './cleaning.service.js';
import { CreateCleaningTaskDto } from './dto/create-cleaning-task.dto.js';
import { QueryCleaningTasksDto } from './dto/query-cleaning-tasks.dto.js';
import { AssignCleanerDto } from './dto/assign-cleaner.dto.js';
import { CompleteCleaningDto } from './dto/complete-cleaning.dto.js';
import { AcceptCleaningDto, RejectCleaningDto } from './dto/accept-cleaning.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

@Controller('cleaning/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CleaningController {
  constructor(private readonly cleaningService: CleaningService) {}

  /**
   * 手动创建保洁工单（管理员/物业管家）
   */
  @Post()
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  create(
    @CurrentUser() userParam: CurrentUserParam,
    @Body() dto: CreateCleaningTaskDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.create(dto, user);
  }

  /**
   * 查询保洁工单列表（管理员/物业管家）
   */
  @Get()
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  findAll(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryCleaningTasksDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.findAll(query, user);
  }

  /**
   * 保洁员端：查询指派给本人的任务
   */
  @Get('assigned')
  @Roles('CLEANER')
  findAssigned(
    @CurrentUser() userParam: CurrentUserParam,
    @Query() query: QueryCleaningTasksDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.findAssignedToCleaner(user.userId, query);
  }

  /**
   * 查询单条工单详情
   */
  @Get(':id')
  @Roles('ADMIN', 'PROPERTY_MANAGER', 'CLEANER')
  findOne(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.findOne(id, user);
  }

  /**
   * 指派保洁员（管理员/物业管家）
   */
  @Post(':id/assign')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  assign(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: AssignCleanerDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.assignCleaner(id, dto, user);
  }

  /**
   * 保洁员开工/接单
   */
  @Post(':id/start')
  @Roles('CLEANER', 'ADMIN')
  start(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.startCleaning(id, user);
  }

  /**
   * 保洁员完工提报
   */
  @Post(':id/complete')
  @Roles('CLEANER', 'ADMIN')
  complete(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: CompleteCleaningDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.completeCleaning(id, dto, user);
  }

  /**
   * 验收通过并归档（房间自动流转为已清洁 CLEAN）
   */
  @Post(':id/accept')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  accept(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: AcceptCleaningDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.acceptCleaning(id, dto, user);
  }

  /**
   * 验收驳回返工
   */
  @Post(':id/reject')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  reject(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
    @Body() dto: RejectCleaningDto,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.rejectCleaning(id, dto, user);
  }

  /**
   * 取消工单
   */
  @Post(':id/cancel')
  @Roles('ADMIN', 'PROPERTY_MANAGER')
  cancel(
    @CurrentUser() userParam: CurrentUserParam,
    @Param('id') id: string,
  ) {
    const user = resolveAuthUser(userParam);
    return this.cleaningService.cancel(id, user);
  }
}
