import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

function controller(env: Record<string, string>) {
  const metrics = new MetricsService();
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return { controller: new MetricsController(metrics, config), metrics };
}

function response() {
  return { setHeader: () => undefined } as never;
}

describe('MetricsController（T277）', () => {
  it('开发环境默认暴露，输出 Prometheus 文本', () => {
    const { controller: instance } = controller({ NODE_ENV: 'development' });
    const text = instance.scrape({ headers: {} } as never, undefined, response());
    expect(text).toContain('# TYPE app_process_uptime_seconds gauge');
  });

  it('配置 token 后必须携带正确 Bearer，错误 token 401', () => {
    const { controller: instance } = controller({ NODE_ENV: 'production', METRICS_TOKEN: 's3cret' });

    expect(() => instance.scrape({ headers: {} } as never, undefined, response())).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      instance.scrape({ headers: { authorization: 'Bearer wrong' } } as never, undefined, response()),
    ).toThrow(UnauthorizedException);
    expect(
      instance.scrape({ headers: { authorization: 'Bearer s3cret' } } as never, undefined, response()),
    ).toContain('app_process_uptime_seconds');
    expect(instance.scrape({ headers: {} } as never, 's3cret', response())).toContain(
      'app_process_uptime_seconds',
    );
  });

  it('生产/预发未配置 token 时 404，不暴露指标', () => {
    for (const env of ['production', 'staging']) {
      const { controller: instance } = controller({ NODE_ENV: env });
      expect(() => instance.scrape({ headers: {} } as never, undefined, response())).toThrow(
        NotFoundException,
      );
    }
  });
});
