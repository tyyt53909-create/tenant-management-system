import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class InviteCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成邀请码（管理员专用）
   */
  async generateInviteCode(
    adminUserId: string,
    expiryDays: number = 365,
  ): Promise<string> {
    const inviteCode = `INVITE-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const expiredAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: adminUserId },
      data: {
        inviteCode,
        inviteExpiredAt: expiredAt,
      },
    });

    return inviteCode;
  }

  /**
   * 验证邀请码（注册时使用）
   * 返回：邀请码有效性和邀请人ID
   */
  async validateInviteCode(code: string): Promise<{ valid: boolean; invitedBy?: string }> {
    const user = await this.prisma.user.findFirst({
      where: {
        inviteCode: code,
      },
      select: {
        id: true,
        inviteCode: true,
        inviteExpiredAt: true,
        role: true,
      },
    });

    // 邀请码不存在；或已被使用（一次性语义：注册事务会清空 inviteCode，
    // 见 auth.controller 注册流程与 docs/03-权限矩阵.md §4.1「使用后立即失效」）
    if (!user || !user.inviteCode) {
      return { valid: false };
    }

    // 邀请码已过期
    if (user.inviteExpiredAt && new Date() > user.inviteExpiredAt) {
      throw new BadRequestException('邀请码已过期');
    }

    return { valid: true, invitedBy: user.id };
  }

  /**
   * 检查用户是否有有效的邀请码
   */
  async hasValidInviteCode(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        inviteCode: true,
        inviteExpiredAt: true,
      },
    });

    if (!user || !user.inviteCode) {
      return false;
    }

    // 已过期
    if (user.inviteExpiredAt && new Date() > user.inviteExpiredAt) {
      return false;
    }

    return true;
  }

  /**
   * 批量生成邀请码
   */
  async generateBatchInviteCodes(
    adminUserId: string,
    count: number,
    expiryDays: number = 365,
  ): Promise<string[]> {
    const codes: string[] = [];
    
    for (let i = 0; i < count; i++) {
      const code = await this.generateInviteCode(adminUserId, expiryDays);
      codes.push(code);
      // 避免时间戳重复，稍微延迟
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return codes;
  }
}
