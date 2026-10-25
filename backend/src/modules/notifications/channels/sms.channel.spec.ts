import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmsChannel } from './sms.channel.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SmsService } from '../../sms/sms.service.js';

describe('SmsChannel', () => {
  let channel: SmsChannel;
  let prisma: any;
  let smsService: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
      },
    };
    smsService = {
      sendNotification: vi.fn().mockResolvedValue({
        success: true,
        messageId: 'msg-sms-001',
      }),
    };
    channel = new SmsChannel(prisma as PrismaService, smsService as SmsService);
  });

  it('用户未绑定手机号时优雅跳过', async () => {
    prisma.user.findUnique.mockResolvedValue({ phone: null });

    const result = (await channel.send({
      userId: 'user_without_phone',
      title: '紧急催缴',
      body: '请尽快缴纳租金',
      priority: 'URGENT',
    })) as any;

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('NO_PHONE');
    expect(smsService.sendNotification).not.toHaveBeenCalled();
  });

  it('用户拥有手机号时成功调用短信服务下发', async () => {
    prisma.user.findUnique.mockResolvedValue({ phone: '13812345678' });

    const result = (await channel.send({
      userId: 'user_with_phone',
      title: '紧急催缴',
      body: '请尽快缴纳租金',
      priority: 'URGENT',
    })) as any;

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-sms-001');
    expect(smsService.sendNotification).toHaveBeenCalledWith(
      '13812345678',
      '紧急催缴：请尽快缴纳租金',
    );
  });

  it('message 显式携带 phone 时不查库直接发送', async () => {
    const result = (await channel.send({
      userId: 'user_explicit',
      phone: '13999999999',
      title: '报修进展',
      body: '维修师傅已出发',
      priority: 'NORMAL',
    })) as any;

    expect(result.success).toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(smsService.sendNotification).toHaveBeenCalledWith(
      '13999999999',
      '报修进展：维修师傅已出发',
    );
  });

  it('短信服务返回失败时返回 success false', async () => {
    prisma.user.findUnique.mockResolvedValue({ phone: '13812345678' });
    smsService.sendNotification.mockResolvedValue({
      success: false,
      message: '余额不足',
    });

    const result = (await channel.send({
      userId: 'u1',
      title: '通知',
      body: '内容',
      priority: 'NORMAL',
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error).toBe('余额不足');
  });
});
