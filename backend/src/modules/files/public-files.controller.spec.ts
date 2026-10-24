import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { PublicFilesController } from './public-files.controller.js';
import { FilesService } from './files.service.js';

function responseMock() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    send: vi.fn(),
  };
}

describe('PublicFilesController', () => {
  it('公开文件返回缓存头与正确 Content-Type', async () => {
    const service = {
      readPublic: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicFilesController],
      providers: [{ provide: FilesService, useValue: service }],
    }).compile();
    const controller = moduleRef.get(PublicFilesController);
    const res = responseMock();

    await controller.getFile('cover.png', res as never);

    expect(service.readPublic).toHaveBeenCalledWith('cover.png');
    expect(res.headers['Cache-Control']).toBe('public, max-age=3600');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.send).toHaveBeenCalled();
  });

  it('私有对象由 service 抛 404，不写响应', async () => {
    const service = {
      readPublic: vi.fn().mockRejectedValue(Object.assign(new Error('文件不存在'), { status: 404 })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicFilesController],
      providers: [{ provide: FilesService, useValue: service }],
    }).compile();
    const controller = moduleRef.get(PublicFilesController);
    const res = responseMock();

    await expect(controller.getFile('private.png', res as never)).rejects.toMatchObject({
      status: 404,
    });
    expect(res.send).not.toHaveBeenCalled();
  });
});
