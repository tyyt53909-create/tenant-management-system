import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AlertPayload {
  title: string;
  severity: 'warning' | 'error' | 'critical';
  message: string;
  /** 同一 dedupeKey 在限频窗口内只发一次 */
  dedupeKey?: string;
  context?: Record<string, unknown>;
}

/**
 * 通用告警出口（OPS-04 / T277）。
 *
 * 不绑定具体平台：通过 ALERT_WEBHOOK_URL 发送 JSON，可接企业微信/钉钉/Slack 中转或自建告警服务。
 * 未配置 URL 时只写结构化日志，不影响主流程。
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly lastSent = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  async send(payload: AlertPayload): Promise<boolean> {
    const url = this.config.get<string>('ALERT_WEBHOOK_URL')?.trim();
    const dedupeKey = payload.dedupeKey ?? payload.title;
    const interval = Number(this.config.get<string>('ALERT_MIN_INTERVAL_MS') ?? 60_000);
    const now = Date.now();
    const last = this.lastSent.get(dedupeKey) ?? 0;
    if (now - last < (Number.isFinite(interval) ? interval : 60_000)) {
      return false;
    }
    this.lastSent.set(dedupeKey, now);

    if (!url) {
      this.logger.warn(
        `[ALERT:${payload.severity}] ${payload.title} - ${payload.message}`,
      );
      return false;
    }

    try {
      const token = this.config.get<string>('ALERT_WEBHOOK_TOKEN')?.trim();
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ...payload,
          service: 'tenant-management-system',
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        this.logger.error(`告警发送失败：HTTP ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        `告警发送异常：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
