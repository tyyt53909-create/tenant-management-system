import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { FilesService } from './files.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// 真实 PNG 夹具（**故意带 EXIF**）：原先内嵌的 1×1 base64 本身不合规（libpng 读不了），
// 重编码清 EXIF 这条路径在测试里从未真正跑过 —— 夹具必须能被解码，测试才有意义（T209）
const PNG = await sharp({
  create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
})
  .withMetadata({ exif: { IFD0: { Copyright: 'tenant-system-test', Software: 'T209' } } })
  .png()
  .toBuffer();

/**
 * 文件归属与下载授权（T159 安全修复）。
 *
 * 背景：GET /files/:key 原先仅要求登录，任何已登录用户（含租客）
 * 拿到 key 即可下载任意文件，且 signUrl 为假签名。
 */
describe('FilesService', () => {
  let service: FilesService;
  let prisma: any;
  let uploadDir: string;
  const previousUpload = process.env.UPLOAD_DIR;
  const previousDriver = process.env.STORAGE_DRIVER;

  beforeEach(async () => {
    uploadDir = await mkdtemp(join(tmpdir(), 'files-'));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.STORAGE_DRIVER = 'local';
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

  afterEach(async () => {
    if (previousUpload === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUpload;
    if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = previousDriver;
    await rm(uploadDir, { recursive: true, force: true });
  });

  function pngFile(name = 'p.png') {
    return { mimetype: 'image/png', size: PNG.length, originalname: name, buffer: PNG };
  }

  it('无文件应抛错', async () => {
    await expect(service.save(undefined as any)).rejects.toThrow(BadRequestException);
  });

  it('落盘的 PNG 原图已清除 EXIF（T209：此前只对 JPEG 重编码）', async () => {
    // 先确认测试前提：夹具本身确实是带 EXIF 的
    expect((await sharp(PNG).metadata()).exif).toBeDefined();

    const saved = await service.save(pngFile() as any);
    const stored = await service.read(saved.key);

    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe('png');
    expect(meta.exif).toBeUndefined();
  });

  it('非图片类型应拒绝', async () => {
    await expect(
      service.save({ mimetype: 'application/pdf', size: 100, originalname: 'a.pdf', buffer: Buffer.alloc(10) } as any),
    ).rejects.toThrow('仅支持 JPG/PNG/WebP');
  });

  it('超大文件应拒绝', async () => {
    await expect(
      service.save({ mimetype: 'image/png', size: 11 * 1024 * 1024, originalname: 'a.png', buffer: PNG } as any),
    ).rejects.toThrow('最大 10MB');
  });

  it('非法key应拒绝路径穿越', () => {
    expect(() => service.filePath('../secret')).toThrow(BadRequestException);
  });

  // ── T159：上传登记归属 ──

  it('TENANT 上传 → 记录 uploadedBy 与 tenantId', async () => {
    prisma.fileAsset.create.mockResolvedValue({});

    const res = await service.save(pngFile() as any, { userId: 'u-1', role: 'TENANT', tenantId: 't-1' });

    expect(res.url).toBe('/api/files/' + res.key);
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: res.key,
        uploadedBy: 'u-1',
        tenantId: 't-1',
        purpose: 'OTHER',
        visibility: 'PRIVATE',
      }),
      select: { id: true },
    });
  });

  it('ADMIN 上传 → tenantId 为 null', async () => {
    prisma.fileAsset.create.mockResolvedValue({});

    await service.save(pngFile() as any, { userId: 'admin-1', role: 'ADMIN' });

    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ uploadedBy: 'admin-1', tenantId: null }),
      select: { id: true },
    });
  });

  it('管理员上传公开房源照片：返回公开地址并记录 PUBLIC', async () => {
    prisma.fileAsset.create.mockResolvedValue({ id: 'asset-1' });

    const res = await service.save(
      pngFile() as any,
      { userId: 'admin-1', role: 'ADMIN' },
      { purpose: 'ROOM_PHOTO', visibility: 'PUBLIC' },
    );

    expect(res.visibility).toBe('PUBLIC');
    expect(res.purpose).toBe('ROOM_PHOTO');
    expect(res.id).toBe('asset-1');
    expect(res.url).toBe('/api/public/files/' + res.key);
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ visibility: 'PUBLIC', purpose: 'ROOM_PHOTO' }),
      select: { id: true },
    });
  });

  it('非管理员上传公开文件被拒绝', async () => {
    await expect(
      service.save(
        pngFile() as any,
        { userId: 'u-1', role: 'TENANT' },
        { visibility: 'PUBLIC' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it('公开读取只返回 visibility=PUBLIC 的对象', async () => {
    prisma.fileAsset.create.mockResolvedValue({ id: 'asset-1' });
    const pub = await service.save(
      pngFile('public.png') as any,
      { userId: 'admin-1', role: 'ADMIN' },
      { purpose: 'ROOM_PHOTO', visibility: 'PUBLIC' },
    );
    const priv = await service.save(pngFile('private.png') as any, {
      userId: 'u-1',
      role: 'TENANT',
      tenantId: 't-1',
    });

    prisma.fileAsset.findUnique.mockResolvedValueOnce({ visibility: 'PRIVATE' });
    await expect(service.readPublic(priv.key)).rejects.toMatchObject({ status: 404 });

    prisma.fileAsset.findUnique.mockResolvedValueOnce({ visibility: 'PUBLIC' });
    const body = await service.readPublic(pub.key);
    expect(body.length).toBeGreaterThan(0);
  });

  it('归属登记失败不阻断上传（文件已落盘）', async () => {
    prisma.fileAsset.create.mockRejectedValue(new Error('db down'));

    const res = await service.save(pngFile() as any, { userId: 'u-1', role: 'TENANT', tenantId: 't-1' });

    expect(res.key).toBeTruthy();
  });

  it('把非图片内容伪装成 png 时拒绝，并且不写盘', async () => {
    await expect(
      service.save({
        mimetype: 'image/png',
        size: 28,
        originalname: 'fake.png',
        buffer: Buffer.from('<script>not a PNG</script>'),
      } as any),
    ).rejects.toThrow('不是有效的图片');
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it('上传后返回去掉 EXIF 的缩略图地址', async () => {
    prisma.fileAsset.create.mockResolvedValue({});
    const jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().withMetadata({
      exif: {
        IFD0: { ImageDescription: 'gps-test' },
        GPS: { GPSLatitudeRef: 'N', GPSLatitude: '22/1 32/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '114/1 8/1 0/1' },
      } as any,
    }).toBuffer();

    const res = await service.save(
      { mimetype: 'image/jpeg', size: jpeg.length, originalname: 'place.jpg', buffer: jpeg } as any,
      { userId: 'u-1', role: 'TENANT', tenantId: 't-1' },
    );

    expect(res.thumbnail).toMatch(/\.thumb\.jpg$/);
    const original = await service.read(res.key);
    const thumb = await service.read(res.thumbnail!.replace('/api/files/', ''));
    expect((await sharp(original).metadata()).exif).toBeUndefined();
    expect((await sharp(thumb).metadata()).exif).toBeUndefined();
    expect(thumb.includes(Buffer.from('gps-test'))).toBe(false);
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
