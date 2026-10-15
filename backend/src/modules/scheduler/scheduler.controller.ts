import { Controller, Post, UseGuards } from '@nestjs/common';
import { SchedulerService } from './scheduler.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

/**
 * 定时任务手动触发（运维/测试用，docs/05-接口规范.md §8.14）
 * 正式调度由 @nestjs/schedule 在进程内自动执行
 */
@Controller('scheduler')
@UseGuards(JwtAuthGuard)
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  /** 手动触发每日任务（合同流转/逾期检查/提醒/报修自动确认/预付提醒） */
  @Post('run-daily')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  runDaily() {
    return this.schedulerService.runDaily();
  }

  /** 手动触发月度账单生成 */
  @Post('run-monthly-bills')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  runMonthlyBills() {
    return this.schedulerService.generateMonthlyBills();
  }
}
