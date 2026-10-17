export interface NotificationMessage {
  userId: string;
  email?: string | null;
  title: string;
  body: string;
  priority: 'NORMAL' | 'URGENT';
  data?: Record<string, unknown>;
  expiredAt?: Date;
  /** 指定渠道名。不传时由调度器按优先级选择。 */
  channels?: string[];
}

export interface NotificationChannel {
  readonly name: string;
  send(message: NotificationMessage): Promise<unknown>;
}
