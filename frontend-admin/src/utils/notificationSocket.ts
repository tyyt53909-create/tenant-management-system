import { io, type Socket } from 'socket.io-client';

/**
 * 通知实时通道（COM-02 / T282）。
 *
 * - 优先 WebSocket；连接失败/断开时由调用方回退到轮询未读数。
 * - token 使用 Access Token；过期后由现有 request 层刷新，重连时重新取 token。
 */
export function createNotificationSocket(getToken: () => string | null): Socket {
  const base = import.meta.env.VITE_WS_URL || window.location.origin;
  return io(`${base}/notifications`, {
    auth: { token: getToken() },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });
}

export function notificationSocketUrl(): string {
  return import.meta.env.VITE_WS_URL || window.location.origin;
}
