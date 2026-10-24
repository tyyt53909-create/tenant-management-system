import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertService } from './alert.service.js';

describe('AlertService（T277）', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('未配置 webhook 时只记日志，不发起网络请求', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;
    const service = new AlertService(new ConfigService({}));

    const sent = await service.send({ title: 't', severity: 'error', message: 'm' });

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('配置 webhook 时发送 JSON，并带 Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as never;
    const service = new AlertService(
      new ConfigService({
        ALERT_WEBHOOK_URL: 'https://alerts.example/hook',
        ALERT_WEBHOOK_TOKEN: 'secret',
      }),
    );

    const sent = await service.send({
      title: 'HTTP 5xx',
      severity: 'error',
      message: 'boom',
      dedupeKey: 'k1',
      context: { requestId: 'r1' },
    });

    expect(sent).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://alerts.example/hook');
    expect(options.headers.authorization).toBe('Bearer secret');
    expect(JSON.parse(options.body)).toMatchObject({ title: 'HTTP 5xx', context: { requestId: 'r1' } });
  });

  it('同一 dedupeKey 在限频窗口内只发送一次', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as never;
    const service = new AlertService(
      new ConfigService({ ALERT_WEBHOOK_URL: 'https://alerts.example/hook', ALERT_MIN_INTERVAL_MS: '60000' }),
    );

    expect(await service.send({ title: 't', severity: 'error', message: 'm', dedupeKey: 'same' })).toBe(true);
    expect(await service.send({ title: 't', severity: 'error', message: 'm', dedupeKey: 'same' })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('webhook 超时/网络错误不抛出', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as never;
    const service = new AlertService(new ConfigService({ ALERT_WEBHOOK_URL: 'https://x' }));
    await expect(service.send({ title: 't', severity: 'error', message: 'm' })).resolves.toBe(false);
  });
});
