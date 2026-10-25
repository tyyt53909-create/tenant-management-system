import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { resolveCorsOrigins } from '../../config/cors.config.js';
import { JwtAuthService } from '../auth/jwt.service.js';

interface AuthedSocketData {
  userId?: string;
}

/**
 * 通知实时通道（COM-02 / T282）。
 *
 * - 命名空间：`/notifications`
 * - 鉴权：只接受 `handshake.auth.token` 的 **Access Token**；query string 会被代理日志记下，一律忽略
 * - 房间：`user:{userId}`，只向本人推送
 * - CORS 与 HTTP 共用 `CORS_ORIGINS` 白名单
 * - 离线/不支持 WebSocket 时客户端回退到 `GET /notifications/unread-count` 轮询
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: (origin, callback) => {
      if (!origin || resolveCorsOrigins(process.env.CORS_ORIGINS).includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('origin not allowed'), false);
    },
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server?: Server;

  constructor(private readonly jwt: JwtAuthService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = readToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyToken(token);
      if (payload.tokenType !== 'ACCESS' || !payload.sub) {
        throw new Error('token type mismatch');
      }
      const data = client.data as AuthedSocketData;
      data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
      this.logger.debug(`通知通道已连接 user=${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as AuthedSocketData;
    if (data.userId) this.logger.debug(`通知通道断开 user=${data.userId}`);
  }

  /** 向指定用户推送新通知；未初始化 WS server（如 Worker/测试）时静默跳过。 */
  emitNotification(userId: string, notification: unknown): void {
    this.server?.to(`user:${userId}`).emit('notification', notification);
  }
}

function readToken(client: Socket): string | undefined {
  const authToken = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
  return undefined;
}
