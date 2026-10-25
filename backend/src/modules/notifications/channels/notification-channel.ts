export interface NotificationMessage {
  userId: string;
  email?: string | null;
  phone?: string | null;
  title: string;
  body: string;
  priority: 'NORMAL' | 'URGENT';
  data?: Record<string, unknown>;
  expiredAt?: Date;
  /** 同一用户、同一业务事件的去重键。不传则允许重复。 */
  dedupKey?: string | null;
  /** 指定渠道名。不传时由调度器按优先级选择。 */
  channels?: string[];
}

export interface NotificationChannel {
  readonly name: string;
  send(message: NotificationMessage): Promise<unknown>;
}
