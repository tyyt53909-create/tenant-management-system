import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { InviteCodeService } from './invite-code.service';
import { JwtAuthService } from './jwt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let inviteCodeService: InviteCodeService;
  let jwtService: JwtAuthService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: InviteCodeService,
          useValue: {
            validateInviteCode: vi.fn(),
          },
        },
        {
          provide: JwtAuthService,
          useValue: {
            generateTokens: vi.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: vi.fn(),
              create: vi.fn(),
            },
            tenant: {
              create: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    inviteCodeService = module.get<InviteCodeService>(InviteCodeService);
    jwtService = module.get<JwtAuthService>(JwtAuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('应该定义控制器', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    const dto: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      inviteCode: 'INVITE-123',
    };

    it('应该成功注册用户', async () => {
      const mockUser = {
        id: 'user-123',
        email: dto.email,
        role: 'TENANT',
      };

      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          user: {
            create: vi.fn().mockResolvedValue(mockUser),
          },
          tenant: {
            create: vi.fn().mockResolvedValue({}),
          },
        });
      });
      vi.spyOn(jwtService, 'generateTokens').mockResolvedValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });

      const result = await controller.register(dto);

      expect(result.accessToken).toBe('access-token');
      expect(result.user.id).toBe('user-123');
    });

    it('应该拒绝无效的邀请码', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: false,
      });

      await expect(controller.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('应该拒绝已注册的邮箱', async () => {
      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: 'existing-user',
      } as any);

      await expect(controller.register(dto)).rejects.toThrow(ConflictException);
    });

    it('应该拒绝已注册的手机号', async () => {
      const dtoWithPhone = { ...dto, phone: '13800138000' };

      vi.spyOn(inviteCodeService, 'validateInviteCode').mockResolvedValue({
        valid: true,
        invitedBy: 'admin-123',
      });
      // 第一次调用（检查邮箱）返回 null
      vi.spyOn(prisma.user, 'findUnique')
        .mockResolvedValueOnce(null)
        // 第二次调用（检查手机号）返回已存在用户
        .mockResolvedValueOnce({
          id: 'existing-user',
        } as any);

      await expect(controller.register(dtoWithPhone)).rejects.toThrow(ConflictException);
    });
  });
});
