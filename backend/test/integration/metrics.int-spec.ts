import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createApp, http } from './harness.js';

/** OPS-04 / T277：指标抓取端点（真实 HTTP） */
let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
}, 30_000);

afterAll(async () => {
  await app?.close();
});

describe('指标端点（OPS-04）', () => {
  it('默认测试环境暴露 Prometheus 文本，并记录 HTTP 请求指标', async () => {
    const live = await http(app).get('/health/live');
    expect(live.status).toBe(200);

    const response = await http(app).get('/metrics');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# TYPE app_process_uptime_seconds gauge');
    expect(response.text).toContain('app_http_requests_total{');
    expect(response.text).toContain('app_http_request_duration_seconds_bucket{');
  });
});
