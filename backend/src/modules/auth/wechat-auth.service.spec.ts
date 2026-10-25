import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { WechatAuthService } from './wechat-auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { JwtAuthService } from './jwt.service.js';
import { InviteCodeService } from './invite-code.service.js';
import { WechatApiService } from './wechat-api.service.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { ErrorCode } from '../../common/errors/error-codes.js';

describe('WechatAuthService', () => {
  let service: WechatAuthService;
  let prisma: any;
  let redis: any;
  let jwtService: any;
  let inviteCodeService: any;
  let wechatApiService: any;
  let auditLog: any;

  beforeEach(() => {
    prisma = {
      userIdentity: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
      user: {
        findFirst: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
      },
      tenant: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn().mockImplementation(async (cb: any) => cb(prisma)),
    };

    redis = {
      ready: true,
      client: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
      },
    };

    jwtService = {
      generateTokens: vi.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      }),
    };

    inviteCodeService = {
      validateInviteCode: vi.fn(),
      consumeInviteCode: vi.fn().mockResolvedValue(undefined),
    };

    wechatApiService = {
      getAppId: vi.fn().mockReturnValue('test-appid'),
      isMockEnabled: vi.fn().mockReturnValue(true),
      jscode2session: vi.fn(),
      getPhoneNumber: vi.fn(),
    };

    auditLog = {
      log: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
    };

    service = new WechatAuthService(
      prisma as PrismaService,
      redis as RedisService,
      jwtService as JwtAuthService,
      inviteCodeService as InviteCodeService,
      wechatApiService as WechatApiService,
      auditLog as AuditLogService,
    );
  });

  describe('login', () => {
    it('已绑定且活跃账号：直接发放登录态并记录脱敏审计', async () => {
      wechatApiService.jscode2session.mockResolvedValue({
        openid: 'wx_user_openid_123',
        sessionKey: 'sk_1',
      });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 'ident-1',
        provider: 'WECHAT_MP',
        providerUserId: 'wx_user_openid_123',
        user: {
          id: 'u-1',
          role: 'TENANT',
          isActive: true,
          email: 't@example.com',
          phone: '13911112222',
        },
      });

      const res = await service.login({ code: 'valid_code' });
      expect(res.isBound).toBe(true);
      expect(res.accessToken).toBe('mock-access-token');
      expect(res.user?.id).toBe('u-1');
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WECHAT_LOGIN',
          userId: 'u-1',
          changes: expect.objectContaining({ openidMasked: 'wx_u****_123' }),
        }),
      );
    });

    it('已绑定但账号已停用：抛出 ForbiddenException', async () => {
      wechatApiService.jscode2session.mockResolvedValue({
        openid: 'wx_disabled_openid',
        sessionKey: 'sk_1',
      });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 'ident-2',
        provider: 'WECHAT_MP',
        providerUserId: 'wx_disabled_openid',
        user: {
          id: 'u-2',
          role: 'TENANT',
          isActive: false,
        },
      });

      await expect(service.login({ code: 'code_disabled' })).rejects.toThrow(ForbiddenException);
    });

    it('未绑定 openid：绝不自动创建 User/Tenant，保存 5 分钟 bindTicket 并抛出 AUTH_WECHAT_UNBOUND', async () => {
      wechatApiService.jscode2session.mockResolvedValue({
        openid: 'wx_unbound_openid_888',
        sessionKey: 'sk_1',
      });
      prisma.userIdentity.findUnique.mockResolvedValue(null);

      try {
        await service.login({ code: 'code_unbound' });
        expect.unreachable('应当抛出错误');
      } catch (err: any) {
        expect(err.getStatus?.()).toBe(400);
        const resp = err.getResponse?.() as any;
        expect(resp.code).toBe(ErrorCode.AUTH_WECHAT_UNBOUND);
        expect(resp.details?.bindTicket).toMatch(/^wt_[a-f0-9]{48}$/);
      }

      // 绝未调用 user.create 或 tenant.create
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.tenant.create).not.toHaveBeenCalled();
      expect(redis.client.set).toHaveBeenCalledWith(
        expect.stringMatching(/^wechat:bind_ticket:wt_/),
        expect.stringContaining('wx_unbound_openid_888'),
        'PX',
        300000,
      );
    });
  });

  describe('bind', () => {
    it('凭证失效或重放：抛出 AUTH_CLAIM_REVERIFY', async () => {
      redis.client.get.mockResolvedValue(null); // 无效票据
      await expect(
        service.bind({ bindTicket: 'wt_invalid', phoneCode: 'p_1' }),
      ).rejects.toThrow(/绑定凭据已失效/);
    });

    it('openid 并发已被其他用户绑定：抛出 409', async () => {
      redis.client.get.mockResolvedValue(
        JSON.stringify({ openid: 'already_bound_openid' }),
      );
      prisma.userIdentity.findUnique.mockResolvedValue({ id: 'ident-exists' });

      await expect(
        service.bind({ bindTicket: 'wt_ok', phoneCode: 'p_1' }),
      ).rejects.toThrow(/已被其他用户绑定/);
    });

    it('手机号路径：未找到预建租客档案时返回 403 AUTH_ACCOUNT_NOT_PROVISIONED', async () => {
      redis.client.get.mockResolvedValue(JSON.stringify({ openid: 'new_openid' }));
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      wechatApiService.getPhoneNumber.mockResolvedValue('13912345678');
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.tenant.findMany.mockResolvedValue([]); // 0 笔

      try {
        await service.bind({ bindTicket: 'wt_ticket', phoneCode: 'phone_code_1' });
        expect.unreachable('应当拒绝');
      } catch (err: any) {
        expect(err.getStatus?.()).toBe(403);
        expect(err.getResponse?.()?.code).toBe(ErrorCode.AUTH_ACCOUNT_NOT_PROVISIONED);
      }
    });

    it('手机号路径：匹配到多条未绑定档案时返回 409 冲突', async () => {
      redis.client.get.mockResolvedValue(JSON.stringify({ openid: 'new_openid' }));
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      wechatApiService.getPhoneNumber.mockResolvedValue('13912345678');
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]); // 2 笔

      try {
        await service.bind({ bindTicket: 'wt_ticket', phoneCode: 'phone_code_1' });
        expect.unreachable('应当拒绝');
      } catch (err: any) {
        expect(err.getStatus?.()).toBe(409);
        expect(err.getResponse?.()?.code).toBe(ErrorCode.COMMON_CONFLICT);
      }
    });

    it('手机号路径：恰好匹配 1 条预建租客档案，原子完成 User 建立与租客认领', async () => {
      redis.client.get.mockResolvedValue(JSON.stringify({ openid: 'new_wx_openid' }));
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      wechatApiService.getPhoneNumber.mockResolvedValue('13912345678');
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.tenant.findMany.mockResolvedValue([
        { id: 'tenant-match-1', phone: '13912345678', email: 'match@example.com' },
      ]);
      prisma.user.create.mockResolvedValue({
        id: 'new-u-1',
        phone: '13912345678',
        email: 'match@example.com',
        role: 'TENANT',
      });

      const result = await service.bind({
        bindTicket: 'wt_ticket_123',
        phoneCode: 'code_phone_valid',
      });

      expect(result.isBound).toBe(true);
      expect(result.accessToken).toBe('mock-access-token');
      expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
        where: { id: 'tenant-match-1', userId: null },
        data: { userId: 'new-u-1' },
      });
      expect(prisma.userIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'new-u-1',
          provider: 'WECHAT_MP',
          providerUserId: 'new_wx_openid',
        }),
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WECHAT_BIND',
          userId: 'new-u-1',
          changes: expect.objectContaining({ method: 'PHONE' }),
        }),
      );
    });

    it('邀请码路径：核销预建租客邀请码并绑定微信身份', async () => {
      redis.client.get.mockResolvedValue(JSON.stringify({ openid: 'wx_invite_user' }));
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      inviteCodeService.validateInviteCode.mockResolvedValue({
        valid: true,
        role: 'TENANT',
        tenantId: 'tenant-invite-1',
        invitedBy: 'admin-1',
      });
      prisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-invite-1',
        phone: '13800000000',
        userId: null,
      });
      prisma.user.create.mockResolvedValue({
        id: 'u-invite-1',
        role: 'TENANT',
      });

      const result = await service.bind({
        bindTicket: 'wt_invite_ticket',
        inviteCode: 'INVITE-TEST-1',
      });

      expect(result.isBound).toBe(true);
      expect(inviteCodeService.consumeInviteCode).toHaveBeenCalledWith(
        'INVITE-TEST-1',
        'u-invite-1',
        expect.anything(),
      );
      expect(prisma.tenant.updateMany).toHaveBeenCalledWith({
        where: { id: 'tenant-invite-1', userId: null },
        data: { userId: 'u-invite-1' },
      });
    });

    it('手机号路径：手机号已在 User 表中存在且活跃时，直接绑定外部身份至既有用户', async () => {
      redis.client.get.mockResolvedValue(JSON.stringify({ openid: 'wx_existing_user' }));
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      wechatApiService.getPhoneNumber.mockResolvedValue('13955556666');
      prisma.user.findFirst.mockResolvedValue({
        id: 'u-existing-99',
        isActive: true,
        role: 'TENANT',
      });
      prisma.user.update.mockResolvedValue({
        id: 'u-existing-99',
        role: 'TENANT',
        phone: '13955556666',
      });

      const result = await service.bind({
        bindTicket: 'wt_ticket_exist',
        phoneCode: 'code_exist',
      });
      expect(result.isBound).toBe(true);
      expect(prisma.userIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u-existing-99',
          provider: 'WECHAT_MP',
          providerUserId: 'wx_existing_user',
        }),
      });
    });

    it('入参校验：缺少 bindTicket 或未提供 inviteCode/phoneCode 时抛出 BadRequestException', async () => {
      await expect(service.bind({ bindTicket: '' } as any)).rejects.toThrow('缺少绑定凭据');
      await expect(
        service.bind({ bindTicket: 'wt_123' } as any),
      ).rejects.toThrow('请提供邀请码或手机号快速验证凭证');
    });

    it('Redis 不可用时回退进程内存保存与消费 bindTicket', async () => {
      redis.ready = false;
      wechatApiService.jscode2session.mockResolvedValue({
        openid: 'wx_memory_ticket_openid',
        sessionKey: 'sk_mem',
      });
      prisma.userIdentity.findUnique.mockResolvedValue(null);

      let ticket = '';
      try {
        await service.login({ code: 'code_mem' });
      } catch (err: any) {
        ticket = err.getResponse?.()?.details?.bindTicket;
      }
      expect(ticket).toBeTruthy();

      // 在内存中消费该 ticket
      wechatApiService.getPhoneNumber.mockResolvedValue('13811223344');
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.tenant.findMany.mockResolvedValue([
        { id: 't-mem-1', phone: '13811223344' },
      ]);
      prisma.user.create.mockResolvedValue({
        id: 'u-mem-1',
        phone: '13811223344',
        role: 'TENANT',
      });

      const bindRes = await service.bind({ bindTicket: ticket, phoneCode: 'p_mem' });
      expect(bindRes.isBound).toBe(true);
    });

    it('getWechatConfig 返回配置', () => {
      expect(service.getWechatConfig()).toEqual({
        appId: 'test-appid',
        mockEnabled: true,
      });
    });
  });
});
