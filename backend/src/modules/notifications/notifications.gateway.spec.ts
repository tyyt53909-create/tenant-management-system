import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsGateway } from './notifications.gateway.js';

function socket(token?: string, origin?: string, id = 'sock-1') {
  return {
    id,
    handshake: {
      auth: token ? { token } : {},
      headers: origin ? { origin } : {},
      query: {},
    },
    data: {},
    join: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  } as never;
}

function setupGatewayWithMiddleware(jwt: any, prisma?: any) {
  const gateway = new NotificationsGateway(jwt as never, prisma as never);
  let middleware: ((socket: any, next: (err?: any) => void) => Promise<void>) | undefined;
  const mockServer = {
    use: vi.fn((fn) => {
      middleware = fn;
    }),
    in: vi.fn().mockReturnValue({
      disconnectSockets: vi.fn(),
    }),
    to: vi.fn().mockReturnValue({
      emit: vi.fn(),
    }),
  };
  gateway.afterInit(mockServer as never);
  gateway.server = mockServer as never;

  const simulateConnection = async (client: any) => {
    let middlewareErr: any;
    await middleware!(client, (err) => {
      middlewareErr = err;
    });
    if (!middlewareErr) {
      await gateway.handleConnection(client);
    }
    return middlewareErr;
  };

  return { gateway, mockServer, simulateConnection };
}

describe('NotificationsGateway（T282 / T322）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('有效 Access Token 且用户活跃正常加入 user 房间', async () => {
    const jwt = { verifyToken: vi.fn().mockResolvedValue({ sub: 'u1', tokenType: 'ACCESS' }) };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN', isActive: true }),
      },
    };
    const { simulateConnection } = setupGatewayWithMiddleware(jwt, prisma);
    const client: any = socket('token-1');

    const err = await simulateConnection(client);
    expect(err).toBeUndefined();
    expect(client.join).toHaveBeenCalledWith('user:u1');
    expect(client.data.userId).toBe('u1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('用户在数据库中不存在或已停用 (isActive=false) 握手阶段立即拒绝', async () => {
    const jwt = { verifyToken: vi.fn().mockResolvedValue({ sub: 'u-inactive', tokenType: 'ACCESS' }) };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u-inactive', role: 'ADMIN', isActive: false }),
      },
    };
    const { simulateConnection } = setupGatewayWithMiddleware(jwt, prisma);
    const client: any = socket('token-inactive');

    const err = await simulateConnection(client);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('user inactive or not found');
    expect(client.join).not.toHaveBeenCalled();

    // 用户不存在
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const client2: any = socket('token-not-found');
    const err2 = await simulateConnection(client2);
    expect(err2).toBeInstanceOf(Error);
    expect(err2.message).toBe('user inactive or not found');
    expect(client2.join).not.toHaveBeenCalled();
  });

  it('TENANT 角色无租客档案时握手阶段拒绝', async () => {
    const jwt = { verifyToken: vi.fn().mockResolvedValue({ sub: 'u-tenant', tokenType: 'ACCESS' }) };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u-tenant',
          role: 'TENANT',
          isActive: true,
          tenant: null,
        }),
      },
    };
    const { simulateConnection } = setupGatewayWithMiddleware(jwt, prisma);
    const client: any = socket('token-tenant-no-profile');

    const err = await simulateConnection(client);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('tenant profile missing');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('缺少 token / refresh token / 校验失败握手阶段一律断开', async () => {
    const jwt = { verifyToken: vi.fn() };
    const { simulateConnection } = setupGatewayWithMiddleware(jwt);

    const noToken: any = socket();
    const err1 = await simulateConnection(noToken);
    expect(err1).toBeInstanceOf(Error);
    expect(err1.message).toBe('missing token');

    jwt.verifyToken.mockResolvedValueOnce({ sub: 'u1', tokenType: 'REFRESH' });
    const refresh: any = socket('refresh');
    const err2 = await simulateConnection(refresh);
    expect(err2).toBeInstanceOf(Error);

    jwt.verifyToken.mockRejectedValueOnce(new Error('bad'));
    const bad: any = socket('bad');
    const err3 = await simulateConnection(bad);
    expect(err3).toBeInstanceOf(Error);
  });

  it('来源 Origin 不在白名单中握手阶段拒绝', async () => {
    const jwt = { verifyToken: vi.fn() };
    const { simulateConnection } = setupGatewayWithMiddleware(jwt);
    const client: any = socket('token-origin', 'http://malicious-site.com');

    const err = await simulateConnection(client);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('origin not allowed');
    expect(jwt.verifyToken).not.toHaveBeenCalled();
  });

  it('已过期的 Token 尝试连接时握手阶段拒绝', async () => {
    const nowSec = 1700000000;
    vi.setSystemTime(nowSec * 1000);

    const jwt = {
      verifyToken: vi.fn().mockResolvedValue({
        sub: 'u1',
        tokenType: 'ACCESS',
        exp: nowSec - 10, // 已过期
      }),
    };
    const { simulateConnection } = setupGatewayWithMiddleware(jwt);
    const client: any = socket('token-expired-already');

    const err = await simulateConnection(client);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('token expired');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('Token 到期后自动触发连接断开', async () => {
    const nowSec = 1700000000;
    vi.setSystemTime(nowSec * 1000);

    const jwt = {
      verifyToken: vi.fn().mockResolvedValue({
        sub: 'u1',
        tokenType: 'ACCESS',
        exp: nowSec + 60, // 60 秒后到期
      }),
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN', isActive: true }),
      },
    };
    const { simulateConnection } = setupGatewayWithMiddleware(jwt, prisma);
    const client: any = socket('token-exp');

    const err = await simulateConnection(client);
    expect(err).toBeUndefined();
    expect(client.disconnect).not.toHaveBeenCalled();

    // 推进 59 秒，仍未断开
    vi.advanceTimersByTime(59_000);
    expect(client.disconnect).not.toHaveBeenCalled();

    // 推进到 60 秒，触发断开
    vi.advanceTimersByTime(1_500);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnectUser 中止该用户所有活跃连接', () => {
    const gateway = new NotificationsGateway({ verifyToken: vi.fn() } as never);
    const disconnectSockets = vi.fn();
    const inMock = vi.fn().mockReturnValue({ disconnectSockets });
    gateway.server = { in: inMock } as never;

    gateway.disconnectUser('u-revoke');

    expect(inMock).toHaveBeenCalledWith('user:u-revoke');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('jwt.revokeUserSessions 撤销事件触发时自动调用 disconnectUser', async () => {
    let hook: ((userId: string) => void) | undefined;
    const jwt = {
      onUserRevoked: vi.fn((fn) => {
        hook = fn;
        return vi.fn();
      }),
      verifyToken: vi.fn(),
    };
    const gateway = new NotificationsGateway(jwt as never);
    const disconnectSockets = vi.fn();
    gateway.server = { in: vi.fn().mockReturnValue({ disconnectSockets }) } as never;

    gateway.onModuleInit();
    expect(jwt.onUserRevoked).toHaveBeenCalled();

    hook!('u-event-revoke');
    expect((gateway.server as any).in).toHaveBeenCalledWith('user:u-event-revoke');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('authenticate 消息可在连线中续期并更新过期定时器', async () => {
    const nowSec = 1700000000;
    vi.setSystemTime(nowSec * 1000);

    const jwt = {
      verifyToken: vi
        .fn()
        .mockResolvedValueOnce({ sub: 'u1', tokenType: 'ACCESS', exp: nowSec + 30 })
        .mockResolvedValueOnce({ sub: 'u1', tokenType: 'ACCESS', exp: nowSec + 120 }),
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: 'ADMIN', isActive: true }),
      },
    };
    const { simulateConnection, gateway } = setupGatewayWithMiddleware(jwt, prisma);
    const client: any = socket('token-orig');

    await simulateConnection(client);

    // 20 秒后发送续期
    vi.advanceTimersByTime(20_000);
    const res = await gateway.handleAuthenticate(client, { token: 'token-renewed' });
    expect(res).toEqual({ success: true });

    // 到了原 30 秒时刻，不会断开（因为已经续期到 120 秒）
    vi.advanceTimersByTime(15_000);
    expect(client.disconnect).not.toHaveBeenCalled();

    // 推进到第 121 秒，触发新定时器断开
    vi.advanceTimersByTime(90_000);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('emitNotification 只向该用户房间推送；无 server 时静默', () => {
    const gateway = new NotificationsGateway({ verifyToken: vi.fn() } as never);
    gateway.emitNotification('u1', { id: 'n1' });
    expect(() => gateway.emitNotification('u1', {})).not.toThrow();

    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;
    gateway.emitNotification('u1', { id: 'n1' });
    expect(to).toHaveBeenCalledWith('user:u1');
    expect(emit).toHaveBeenCalledWith('notification', { id: 'n1' });
  });
});
