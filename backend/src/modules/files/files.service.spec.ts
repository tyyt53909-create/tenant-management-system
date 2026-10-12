import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesService } from './files.service.js';

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
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
});
