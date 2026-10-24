import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics.registry.js';

describe('MetricsRegistry（T277）', () => {
  it('counter 累积并输出 Prometheus 文本', () => {
    const registry = new MetricsRegistry();
    registry.inc('app_http_requests_total', 'HTTP 请求数', { method: 'GET', route: '/api/rooms' });
    registry.inc('app_http_requests_total', 'HTTP 请求数', { method: 'GET', route: '/api/rooms' });

    const text = registry.render();
    expect(text).toContain('# TYPE app_http_requests_total counter');
    expect(text).toContain('app_http_requests_total{method="GET",route="/api/rooms"} 2');
    expect(text).toContain('app_process_uptime_seconds');
    expect(text).toContain('app_process_resident_memory_bytes');
  });

  it('gauge 覆盖写入，并转义标签', () => {
    const registry = new MetricsRegistry();
    registry.setGauge('app_bills_overdue', '逾期账单', 3);
    registry.setGauge('app_bills_overdue', '逾期账单', 5);
    registry.inc('app_x_total', 'x', { note: 'a"b\\c\nd' });

    const text = registry.render();
    expect(text).toContain('app_bills_overdue 5');
    expect(text).toContain('note="a\\"b\\\\c\\nd"');
  });

  it('histogram 输出累积桶、sum 与 count', () => {
    const registry = new MetricsRegistry();
    registry.observe('app_http_request_duration_seconds', '耗时', 0.07, { route: '/x' }, [0.05, 0.1]);
    registry.observe('app_http_request_duration_seconds', '耗时', 0.3, { route: '/x' }, [0.05, 0.1]);

    const text = registry.render();
    expect(text).toContain('app_http_request_duration_seconds_bucket{route="/x",le="0.05"} 0');
    expect(text).toContain('app_http_request_duration_seconds_bucket{route="/x",le="0.1"} 1');
    expect(text).toContain('app_http_request_duration_seconds_bucket{route="/x",le="+Inf"} 2');
    expect(text).toContain('app_http_request_duration_seconds_sum{route="/x"} 0.37');
    expect(text).toContain('app_http_request_duration_seconds_count{route="/x"} 2');
  });
});
