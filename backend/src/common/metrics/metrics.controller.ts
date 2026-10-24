import { Controller, Get, NotFoundException, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Public } from '../decorators/public.decorator.js';
import { SkipThrottle } from '@nestjs/throttler';
import { MetricsService } from './metrics.service.js';

/**
 * Prometheus 抓取端点（OPS-04 / T277）。
 *
 * - 配置 METRICS_TOKEN：要求 Bearer token（或 ?token=），否则 401。
 * - 未配置：仅非 production/staging 暴露；生产返回 404，避免路由/规模泄露。
 */
@Controller('metrics')
@SkipThrottle()
@Public()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  scrape(
    @Req() request: Request,
    @Query('token') queryToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const configured = this.config.get<string>('METRICS_TOKEN')?.trim();
    const provided = readBearer(request) ?? queryToken;
    const env = this.config.get<string>('NODE_ENV') ?? 'development';

    if (configured) {
      if (!provided || !safeEqual(provided, configured)) {
        throw new UnauthorizedException('metrics token 无效');
      }
    } else if (env === 'production' || env === 'staging') {
      throw new NotFoundException();
    }

    response.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    return this.metrics.render();
  }
}

function readBearer(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
