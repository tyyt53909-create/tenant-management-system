import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import { JwtAuthService } from '../../src/modules/auth/jwt.service.js';
import { NotificationPriority } from '../../src/modules/notifications/dto/create-notification.dto.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { createApp, login, prisma, resetDatabase, seedBase } from './harness.js';

let app: INestApplication;
let port: number;

beforeAll(async () => {
  app = await createApp();
  await app.listen(0);
  const server = app.getHttpServer();
  port = server.address().port;
}, 30_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

function toMessageString(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function connectSocketIo(token: string, origin = 'http://localhost:5173'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, {
      headers: {
        Origin: origin,
      },
    });

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 4000);

    let resolved = false;

    ws.on('message', (data: WebSocket.RawData) => {
      const msg = toMessageString(data);
      if (msg.startsWith('0')) {
        // Engine.IO open packet -> 发送 Socket.IO 命名空间连接包
        ws.send(`40/notifications,{"token":"${token}"}`);
      } else if (msg.startsWith('40/notifications')) {
        // 收到连接确认后等待 80ms，确保没有紧随其后的断开指令（服务端校验失败断开）
        setTimeout(() => {
          if (!resolved && ws.readyState === WebSocket.OPEN) {
            clearTimeout(timer);
            resolved = true;
            resolve(ws);
          }
        }, 80);
      } else if (msg.startsWith('41/notifications') || msg.startsWith('44/notifications')) {
        // 服务端拒绝或断开命名空间连接
        clearTimeout(timer);
        ws.close();
        if (!resolved) {
          resolved = true;
          reject(new Error(`Namespace rejected/disconnected: ${msg}`));
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    ws.on('close', (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Socket closed before connect code=${code}`));
      }
    });
  });
}

describe('WebSocket 身份与生命周期集成测试（T322 - R04）', () => {
  it('活跃用户 Access Token 成功连接并收到实时通知', async () => {
    const base = await seedBase();
    const token = await login(app, base.adminEmail, base.adminPassword);

    const ws = await connectSocketIo(token);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const received: string[] = [];
    ws.on('message', (data: WebSocket.RawData) => {
      const msg = toMessageString(data);
      if (msg.startsWith('42/notifications')) {
        received.push(msg);
      }
    });

    const notifService = app.get(NotificationsService);
    await notifService.create({
      userId: base.adminId,
      title: '集成测试通知',
      body: '测试正文',
      priority: NotificationPriority.NORMAL,
    });

    // 等待通知到达
    await new Promise((r) => setTimeout(r, 300));

    expect(received.length).toBe(1);
    expect(received[0]).toContain('集成测试通知');

    ws.close();
  });

  it('停用账号的 Access Token 尝试连接时被断开', async () => {
    const base = await seedBase();
    const token = await login(app, base.adminEmail, base.adminPassword);

    // 将用户在数据库中标记停用
    await prisma.user.update({
      where: { id: base.adminId },
      data: { isActive: false },
    });

    await expect(connectSocketIo(token)).rejects.toThrow();
  });

  it('非法 Origin 请求直接拒绝连接', async () => {
    const base = await seedBase();
    const token = await login(app, base.adminEmail, base.adminPassword);

    await expect(connectSocketIo(token, 'http://malicious-origin.evil.com')).rejects.toThrow();
  });

  it('用户会话撤销时，既有 live 连接被强制中止', async () => {
    const base = await seedBase();
    const token = await login(app, base.adminEmail, base.adminPassword);

    const ws = await connectSocketIo(token);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    const disconnectPromise = new Promise<void>((resolve) => {
      ws.on('message', (data: WebSocket.RawData) => {
        const msg = toMessageString(data);
        if (msg.startsWith('41/notifications')) {
          resolve();
        }
      });
      ws.on('close', () => resolve());
    });

    // 触发撤销会话
    const jwt = app.get(JwtAuthService);
    await jwt.revokeUserSessions(base.adminId);

    // 验证客户端收到 41 断开包或连接关闭
    await expect(
      Promise.race([
        disconnectPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting ws disconnect')), 3000)),
      ]),
    ).resolves.toBeUndefined();

    ws.close();
  });
});
