import { describe, expect, it, vi } from 'vitest';
import { NotificationsGateway } from './notifications.gateway.js';

function socket(token?: string) {
  return {
    handshake: { auth: token ? { token } : {}, query: {} },
    data: {},
    join: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  } as never;
}

describe('NotificationsGateway（T282）', () => {
  it('有效 Access Token 加入 user 房间', async () => {
    const jwt = { verifyToken: vi.fn().mockResolvedValue({ sub: 'u1', tokenType: 'ACCESS' }) };
    const gateway = new NotificationsGateway(jwt as never);
    const client: any = socket('token-1');

    await gateway.handleConnection(client);

    expect(client.join).toHaveBeenCalledWith('user:u1');
    expect(client.data.userId).toBe('u1');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('缺少 token / refresh token / 校验失败一律断开', async () => {
    const jwt = { verifyToken: vi.fn() };
    const gateway = new NotificationsGateway(jwt as never);

    const noToken: any = socket();
    await gateway.handleConnection(noToken);
    expect(noToken.disconnect).toHaveBeenCalledWith(true);

    jwt.verifyToken.mockResolvedValueOnce({ sub: 'u1', tokenType: 'REFRESH' });
    const refresh: any = socket('refresh');
    await gateway.handleConnection(refresh);
    expect(refresh.disconnect).toHaveBeenCalledWith(true);

    jwt.verifyToken.mockRejectedValueOnce(new Error('bad'));
    const bad: any = socket('bad');
    await gateway.handleConnection(bad);
    expect(bad.disconnect).toHaveBeenCalledWith(true);
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
