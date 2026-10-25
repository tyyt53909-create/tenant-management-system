import {
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { resolveCorsOrigins } from '../../config/cors.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthService } from '../auth/jwt.service.js';

interface AuthedSocketData {
  userId?: string;
  expMs?: number;
  expiryTimer?: NodeJS.Timeout;
}

/**
 * 通知实时通道（COM-02 / T282 / T322）。
 *
 * - 命名空间：`/notifications`
 * - 鉴权中间件：只接受 `handshake.auth.token` 的 **Access Token**；query string 一律忽略
 * - 账号校验：中间件级核验账号存在、未停用、租客档案绑定；非法者拒绝握手
 * - 房间：`user:{userId}`，只向本人推送；禁止客户端加入他人房间
 * - CORS 与 HTTP 共用 `CORS_ORIGINS` 白名单
 * - 生命周期：Token 到期后自动断开；用户停用/会话撤销时强制断开既有连接
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
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private unregisterRevocation?: () => void;

  @WebSocketServer()
  server?: Server;

  constructor(
    private readonly jwt: JwtAuthService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const origin = socket.handshake.headers?.origin;
      if (origin && !resolveCorsOrigins(process.env.CORS_ORIGINS).includes(origin)) {
        return next(new Error('origin not allowed'));
      }

      const token = readToken(socket);
      if (!token) {
        return next(new Error('missing token'));
      }

      try {
        const payload = await this.jwt.verifyToken(token);
        if (payload.tokenType !== 'ACCESS' || !payload.sub) {
          return next(new Error('token type mismatch'));
        }

        const now = Date.now();
        const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
        if (expMs !== undefined && expMs <= now) {
          return next(new Error('token expired'));
        }

        if (this.prisma) {
          const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: {
              id: true,
              role: true,
              isActive: true,
              tenant: { select: { id: true } },
            },
          });

          if (!user || !user.isActive) {
            return next(new Error('user inactive or not found'));
          }

          if (user.role === 'TENANT' && !user.tenant?.id) {
            return next(new Error('tenant profile missing'));
          }
        }

        const data = socket.data as AuthedSocketData;
        data.userId = payload.sub;
        data.expMs = expMs;
        next();
      } catch {
        next(new Error('authentication failed'));
      }
    });
  }

  onModuleInit(): void {
    if (this.jwt && typeof this.jwt.onUserRevoked === 'function') {
      this.unregisterRevocation = this.jwt.onUserRevoked((userId) => {
        this.disconnectUser(userId);
      });
    }
  }

  onModuleDestroy(): void {
    this.unregisterRevocation?.();
    for (const timer of this.expiryTimers.values()) {
      clearTimeout(timer);
    }
    this.expiryTimers.clear();
  }

  async handleConnection(client: Socket): Promise<void> {
    const data = client.data as AuthedSocketData;
    // 若中间件未放行或无 userId，立即断开
    if (!data?.userId) {
      client.disconnect(true);
      return;
    }

    try {
      await client.join(`user:${data.userId}`);

      const now = Date.now();
      if (data.expMs !== undefined) {
        const delay = Math.max(0, data.expMs - now);
        const timer = setTimeout(() => {
          this.logger.debug(`通知通道令牌已过期，断开连接 user=${data.userId}`);
          client.disconnect(true);
        }, delay);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
        data.expiryTimer = timer;
        this.expiryTimers.set(client.id, timer);
      }

      this.logger.debug(`通知通道已连接 user=${data.userId}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as AuthedSocketData;
    if (data?.expiryTimer) {
      clearTimeout(data.expiryTimer);
      data.expiryTimer = undefined;
    }
    const timer = this.expiryTimers.get(client.id);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(client.id);
    }
    if (data?.userId) this.logger.debug(`通知通道断开 user=${data.userId}`);
  }

  /**
   * 中止指定用户的所有活跃 WebSocket 连接。
   * 用户被停用、会话被撤销或管理员强制下线时触发。
   */
  disconnectUser(userId: string): void {
    this.logger.debug(`通知通道强制断开所有连接 user=${userId}`);
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }

  /** 向指定用户推送新通知；未初始化 WS server（如 Worker/测试）时静默跳过。 */
  emitNotification(userId: string, notification: unknown): void {
    this.server?.to(`user:${userId}`).emit('notification', notification);
  }

  /**
   * 客户端续期/重新鉴权事件（Token 刷新后无缝换届，无需断开重连）。
   */
  @SubscribeMessage('authenticate')
  async handleAuthenticate(
    client: Socket,
    messageData: { token?: string },
  ): Promise<{ success: boolean }> {
    if (!messageData || typeof messageData.token !== 'string') {
      client.disconnect(true);
      return { success: false };
    }
    const token = messageData.token.trim();
    try {
      const payload = await this.jwt.verifyToken(token);
      const data = client.data as AuthedSocketData;
      if (payload.tokenType !== 'ACCESS' || !payload.sub || payload.sub !== data.userId) {
        throw new Error('user mismatch');
      }
      if (this.prisma) {
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, isActive: true, role: true, tenant: { select: { id: true } } },
        });
        if (!user || !user.isActive) throw new Error('user inactive or not found');
        if (user.role === 'TENANT' && !user.tenant?.id) throw new Error('tenant profile missing');
      }

      const now = Date.now();
      const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
      if (expMs !== undefined && expMs <= now) {
        throw new Error('token expired');
      }

      if (data.expiryTimer) {
        clearTimeout(data.expiryTimer);
        data.expiryTimer = undefined;
      }
      const oldTimer = this.expiryTimers.get(client.id);
      if (oldTimer) {
        clearTimeout(oldTimer);
        this.expiryTimers.delete(client.id);
      }

      if (expMs !== undefined) {
        const delay = Math.max(0, expMs - now);
        const timer = setTimeout(() => {
          this.logger.debug(`通知通道续期令牌已过期，断开连接 user=${payload.sub}`);
          client.disconnect(true);
        }, delay);
        if (typeof timer.unref === 'function') timer.unref();
        data.expiryTimer = timer;
        this.expiryTimers.set(client.id, timer);
      }
      return { success: true };
    } catch {
      client.disconnect(true);
      return { success: false };
    }
  }
}

function readToken(client: Socket): string | undefined {
  const authToken = (client.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
  return undefined;
}
