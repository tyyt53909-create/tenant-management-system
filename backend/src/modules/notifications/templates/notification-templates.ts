import type { NotificationMessage } from '../channels/notification-channel.js';

export type NotificationTemplateKey = 'RENT_BILL' | 'CONTRACT_EXPIRED' | 'MAINTENANCE' | 'GENERIC';

export interface RenderedNotificationTemplate {
  text: string;
  html: string;
}

type TemplateRenderer = (message: NotificationMessage) => RenderedNotificationTemplate;

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const wrap = (heading: string, message: NotificationMessage): RenderedNotificationTemplate => {
  const title = escapeHtml(message.title);
  const body = escapeHtml(message.body).replaceAll('\n', '<br>');
  return {
    text: `${heading}\n\n${message.title}\n${message.body}`,
    html: `<main><h1>${heading}</h1><h2>${title}</h2><p>${body}</p></main>`,
  };
};

export const notificationTemplateRegistry: Record<NotificationTemplateKey, TemplateRenderer> = {
  RENT_BILL: (message) => wrap('租金账单提醒', message),
  CONTRACT_EXPIRED: (message) => wrap('合同到期提醒', message),
  MAINTENANCE: (message) => wrap('报修进度通知', message),
  GENERIC: (message) => wrap('通知提醒', message),
};

export function renderNotificationTemplate(
  templateKey: string | undefined,
  message: NotificationMessage,
): RenderedNotificationTemplate {
  const key = templateKey && Object.hasOwn(notificationTemplateRegistry, templateKey)
    ? (templateKey as NotificationTemplateKey)
    : 'GENERIC';
  return notificationTemplateRegistry[key](message);
}
