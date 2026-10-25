export interface SendSmsOptions {
  phone: string;
  templateCode?: string;
  templateParam?: Record<string, string | number>;
  signName?: string;
  content?: string;
}

export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  code?: string;
  message?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(options: SendSmsOptions): Promise<SendSmsResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
