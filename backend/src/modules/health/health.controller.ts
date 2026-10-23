import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { HealthService } from './health.service.js';

@Controller('health')
@SkipThrottle()
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 进程还活着。不检查数据库、Redis 或磁盘。 */
  @Get()
  live() {
    return this.health.live();
  }

  /** 与 `/health` 同义；供容器编排使用 `/health/live` 探针。 */
  @Get('live')
  liveness() {
    return this.health.live();
  }

  /** 依赖不可用时返回 503。数据库停下后，这个接口失败，/health 仍然是 200。 */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.readiness();
    res.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
