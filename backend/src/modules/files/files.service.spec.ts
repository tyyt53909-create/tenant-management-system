import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * 文件归属与下载授权（T159 安全修复）。
 *
 * 背景：GET /files/:key 原先仅要求登录，任何已登录用户（含租客）
 * 拿到 key 即可下载任意文件，且 signUrl 为假签名。
 */
describe('FilesService', () => {
  let service: FilesService;
  let prisma: any;

  beforeEach(async () => {
    const prismaMock: any = { fileAsset: { create: vi.fn(), findUnique: vi.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: ConfigService, useValue: { get: vi.fn() } },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    prisma = prismaMock;
  });

  it('无文件应抛错', async () => {
    await expect(service.save(undefined as any)).rejects.toThrow(BadRequestException);
  });

  it('非图片类型应拒绝', async () => {
    await expect(
      service.save({ mimetype: 'application/pdf', size: 100, originalname: 'a.pdf', buffer: Buffer.alloc(10) } as any),
    ).rejects.toThrow('仅支持 JPG/PNG/WebP');
  });

  it('超大文件应拒绝', async () => {
    await expect(
      service.save({ mimetype: 'image/png', size: 11 * 1024 * 1024, originalname: 'a.png', buffer: Buffer.alloc(10) } as any),
    ).rejects.toThrow('最大 10MB');
  });

  it('非法key应拒绝路径穿越', () => {
    expect(() => service.filePath('../secret')).toThrow(BadRequestException);
  });

  // ── T159：上传登记归属 ──

  it('TENANT 上传 → 记录 uploadedBy 与 tenantId', async () => {
    prisma.fileAsset.create.mockResolvedValue({});

    const res = await service.save(
      { mimetype: 'image/png', size: 1024, originalname: 'p.png', buffer: Buffer.alloc(10) } as any,
      { userId: 'u-1', role: 'TENANT', tenantId: 't-1' },
    );

    expect(res.url).toBe('/api/files/' + res.key);
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: res.key, uploadedBy: 'u-1', tenantId: 't-1' }),
    });
  });

  it('ADMIN 上传 → tenantId 为 null', async () => {
    prisma.fileAsset.create.mockResolvedValue({});

    await service.save(
      { mimetype: 'image/png', size: 1024, originalname: 'p.png', buffer: Buffer.alloc(10) } as any,
      { userId: 'admin-1', role: 'ADMIN' },
    );

    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ uploadedBy: 'admin-1', tenantId: null }),
    });
  });

  it('归属登记失败不阻断上传（文件已落盘）', async () => {
    prisma.fileAsset.create.mockRejectedValue(new Error('db down'));

    const res = await service.save(
      { mimetype: 'image/png', size: 1024, originalname: 'p.png', buffer: Buffer.alloc(10) } as any,
      { userId: 'u-1', role: 'TENANT', tenantId: 't-1' },
    );

    expect(res.key).toBeTruthy();
  });

  // ── T159：下载授权 ──

  it('ADMIN 可取任意文件，且不查库', async () => {
    await expect(
      service.assertCanRead('any-key', { role: 'ADMIN', userId: 'a-1' }),
    ).resolves.toBeUndefined();
    expect(prisma.fileAsset.findUnique).not.toHaveBeenCalled();
  });

  it('本人上传的文件可取', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ uploadedBy: 'u-1' });

    await expect(
      service.assertCanRead('k', { role: 'TENANT', userId: 'u-1' }),
    ).resolves.toBeUndefined();
  });

  it('他人上传的文件 → 404（不用 403，避免探测 key 是否存在）', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ uploadedBy: 'other-user' });

    await expect(service.assertCanRead('k', { role: 'TENANT', userId: 'u-1' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('无归属记录（历史文件）→ 非管理员一律 404', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue(null);

    await expect(
      service.assertCanRead('legacy-key', { role: 'TENANT', userId: 'u-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('uploadedBy 为空 → 404', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ uploadedBy: null });

    await expect(service.assertCanRead('k', { role: 'TENANT', userId: 'u-1' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('未登录（无 actor）→ 404', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ uploadedBy: 'u-1' });

    await expect(service.assertCanRead('k', undefined)).rejects.toThrow(NotFoundException);
  });

  it('保洁角色同样受归属限制', async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({ uploadedBy: 'tenant-user' });

    await expect(service.assertCanRead('k', { role: 'CLEANER', userId: 'c-1' })).rejects.toThrow(
      NotFoundException,
    );
  });
});
