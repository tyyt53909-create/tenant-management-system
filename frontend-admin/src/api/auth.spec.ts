import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from '@/utils/request';
import { generateInviteCode, getInviteCodes, revokeInviteCode } from './auth';

vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('auth api - invite codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateInviteCode 发起 POST /auth/invite-codes', async () => {
    vi.mocked(request.post).mockResolvedValue({ inviteCodes: ['INV-1'], count: 1 });
    const payload = { count: 3, expiryDays: 30, notes: '秋季招租', role: 'TENANT' as const };
    const res = await generateInviteCode(payload);

    expect(request.post).toHaveBeenCalledWith('/auth/invite-codes', payload);
    expect(res).toEqual({ inviteCodes: ['INV-1'], count: 1 });
  });

  it('getInviteCodes 发起 GET /auth/invite-codes 携带查询参数', async () => {
    vi.mocked(request.get).mockResolvedValue({ data: [], meta: { total: 0 } });
    const params = { page: 1, limit: 10, status: 'UNUSED', search: 'INV' };
    const res = await getInviteCodes(params);

    expect(request.get).toHaveBeenCalledWith('/auth/invite-codes', { params });
    expect(res).toEqual({ data: [], meta: { total: 0 } });
  });

  it('revokeInviteCode 发起 DELETE /auth/invite-codes/:id', async () => {
    vi.mocked(request.delete).mockResolvedValue({ id: 'code-1', status: 'REVOKED' });
    const res = await revokeInviteCode('code-1');

    expect(request.delete).toHaveBeenCalledWith('/auth/invite-codes/code-1');
    expect(res).toEqual({ id: 'code-1', status: 'REVOKED' });
  });
});
