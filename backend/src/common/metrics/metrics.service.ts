import { Injectable } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry.js';

/** 应用指标入口（OPS-04 / T277）。 */
@Injectable()
export class MetricsService {
  private readonly registry = new MetricsRegistry();

  httpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    this.registry.inc(
      'app_http_requests_total',
      'HTTP 请求数',
      { method, route, status: String(status) },
    );
    this.registry.observe(
      'app_http_request_duration_seconds',
      'HTTP 请求耗时（秒）',
      durationSeconds,
      { method, route },
    );
  }

  schedulerRun(job: string, status: string): void {
    this.registry.inc('app_scheduler_runs_total', '定时任务执行次数', { job, status });
  }

  setOverdueBills(count: number): void {
    this.registry.setGauge('app_bills_overdue', '当前逾期未缴清账单数', count);
  }

  render(): string {
    return this.registry.render();
  }

  snapshot() {
    return this.registry.snapshot();
  }
}
