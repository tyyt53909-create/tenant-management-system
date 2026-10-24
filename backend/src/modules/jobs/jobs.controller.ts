import { Controller, Delete, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JobsQueueService } from './jobs-queue.service.js';

/** 队列运维接口（OPS-05 / T278）：仅 ADMIN。 */
@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobs: JobsQueueService) {}

  @Get('stats')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async stats() {
    const stats = await this.jobs.stats();
    return { enabled: this.jobs.enabled, stats };
  }

  @Get('failed')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  failed(@Query('limit') limit?: string) {
    const parsed = Number(limit ?? 20);
    return this.jobs.failed(Number.isFinite(parsed) ? parsed : 20);
  }

  @Post('failed/:id/retry')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async retry(@Param('id') id: string) {
    const ok = await this.jobs.retry(id);
    if (!ok) throw new NotFoundException('失败任务不存在或队列未启用');
    return { message: '已重新入队' };
  }

  @Delete('failed/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async remove(@Param('id') id: string) {
    const ok = await this.jobs.removeFailed(id);
    if (!ok) throw new NotFoundException('失败任务不存在或队列未启用');
    return { message: '已删除失败任务' };
  }
}
