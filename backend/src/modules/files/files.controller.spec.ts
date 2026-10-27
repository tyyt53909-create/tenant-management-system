import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FilesController } from './files.controller.js';
import type { FilesService } from './files.service.js';

/**
 * 回归：T206 修掉「带 ?expiresIn= 就走签名 URL 分支、完全跳过归属校验」的越权。
 *
 * 归属判定本身在 FilesService.assertCanRead 已有完整单测（files.service.spec.ts），
 * 这里补的是控制器接线：无论走哪条下载分支，都必须先过 assertCanRead。
 */
function createController(assertCanRead: (key: string, actor?: unknown) => Promise<void>) {
  const service = {
    assertCanRead: vi.fn(assertCanRead),
    signUrl: vi.fn(async (key: string, expiresIn: number) => ({
      key,
      url: `https://oss.example.com/${key}?sig=stub`,
      expiresIn,
    })),
    read: vi.fn(async () => Buffer.from('file-body')),
  } as unknown as FilesService;

  const res = {
    json: vi.fn((body: unknown) => body),
    send: vi.fn(),
    setHeader: vi.fn(),
  } as unknown as import('express').Response;

  return { controller: new FilesController(service), service, res };
}

const TENANT = { userId: 'u-1', role: 'TENANT' };
const ADMIN = { userId: 'a-1', role: 'ADMIN' };

describe('FilesController.getFile 归属校验', () => {
  it('非本人文件 + expiresIn：拒绝且不签发任何 URL（回归 T206）', async () => {
    const { controller, service, res } = createController(async () => {
      throw new NotFoundException('文件不存在');
    });

    await expect(controller.getFile('other-key', '3600', TENANT, res)).rejects.toThrow(
      NotFoundException,
    );

    expect(service.assertCanRead).toHaveBeenCalledWith('other-key', expect.objectContaining({ userId: 'u-1' }));
    expect(service.signUrl).not.toHaveBeenCalled();
  });

  it('本人文件 + expiresIn：通过校验并回传签名 URL', async () => {
    const { controller, service, res } = createController(async () => undefined);

    const result = await controller.getFile('my-key', '3600', TENANT, res);

    expect(service.assertCanRead).toHaveBeenCalledWith('my-key', expect.objectContaining({ userId: 'u-1' }));
    expect(result).toMatchObject({ key: 'my-key', expiresIn: 3600 });
  });

  it('ADMIN + expiresIn：可签发他人文件的 URL', async () => {
    const { controller, service } = createController(async () => undefined);
    const res = { json: vi.fn((body: unknown) => body) } as unknown as import('express').Response;

    const result = await controller.getFile('any-key', '600', ADMIN, res);

    expect(result).toMatchObject({ key: 'any-key', expiresIn: 600 });
  });

  it('expiresIn 非法值回退 3600 秒', async () => {
    const { controller } = createController(async () => undefined);
    const res = { json: vi.fn((body: unknown) => body) } as unknown as import('express').Response;

    const result = await controller.getFile('my-key', 'abc', TENANT, res);

    expect(result).toMatchObject({ expiresIn: 3600 });
  });

  it('expiresIn 超过 3600 秒时自动封顶 3600 秒', async () => {
    const { controller, service } = createController(async () => undefined);
    const res = { json: vi.fn((body: unknown) => body) } as unknown as import('express').Response;

    await controller.getFile('my-key', '86400', TENANT, res);

    expect(service.signUrl).toHaveBeenCalledWith('my-key', 3600);
  });

  it('非本人文件、不带 expiresIn：同样拒绝且不读取内容', async () => {
    const { controller, service, res } = createController(async () => {
      throw new NotFoundException('文件不存在');
    });

    await expect(controller.getFile('other-key', undefined, TENANT, res)).rejects.toThrow(
      NotFoundException,
    );

    expect(service.read).not.toHaveBeenCalled();
  });
});
