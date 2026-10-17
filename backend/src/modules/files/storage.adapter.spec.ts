import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createStorageAdapter,
  LocalStorage,
  S3CompatibleStorage,
} from './storage.adapter.js';

describe('存储驱动', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('STORAGE_DRIVER=local 与 s3 返回不同实现，业务只依赖同一组方法', () => {
    const local = createStorageAdapter({ STORAGE_DRIVER: 'local', UPLOAD_DIR: '/tmp/local-driver' });
    const s3 = createStorageAdapter({
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'tenant-system',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
      S3_FORCE_PATH_STYLE: 'true',
    });

    expect(local).toBeInstanceOf(LocalStorage);
    expect(s3).toBeInstanceOf(S3CompatibleStorage);
    expect(typeof local.put).toBe('function');
    expect(typeof s3.signedUrl).toBe('function');
  });

  it('未知驱动拒绝创建', () => {
    expect(() => createStorageAdapter({ STORAGE_DRIVER: 'ftp' })).toThrow(/STORAGE_DRIVER/);
  });

  it('本地驱动可以写入、读取和删除', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storage-local-'));
    dirs.push(dir);
    const storage = new LocalStorage(dir);
    await storage.put('photo.png', Buffer.from('png'), 'image/png');
    expect(await storage.get('photo.png')).toEqual(Buffer.from('png'));
    await expect(storage.signedUrl('photo.png', 60)).resolves.toBe('/api/files/photo.png');
    await storage.delete('photo.png');
    await expect(storage.get('photo.png')).rejects.toThrow();
  });

  it('S3 驱动把同一组操作发给兼容客户端', async () => {
    const sent: unknown[] = [];
    const stored = new Map<string, Buffer>();
    const client = {
      async send(command: { constructor: { name: string }; input: { Key: string; Body?: Buffer } }) {
        sent.push(command);
        if (command instanceof PutObjectCommand) stored.set(command.input.Key!, Buffer.from(command.input.Body as Buffer));
        if (command instanceof DeleteObjectCommand) stored.delete(command.input.Key!);
        if (command instanceof GetObjectCommand) {
          const body = stored.get(command.input.Key!);
          return { Body: { transformToByteArray: async () => body ?? new Uint8Array() } };
        }
        return {};
      },
    };
    const storage = new S3CompatibleStorage('bucket', client, async (key, expires) => `https://files.example/${key}?e=${expires}`);

    await storage.put('a.jpg', Buffer.from('jpeg'), 'image/jpeg');
    expect(await storage.get('a.jpg')).toEqual(Buffer.from('jpeg'));
    await expect(storage.signedUrl('a.jpg', 120)).resolves.toBe('https://files.example/a.jpg?e=120');
    await storage.delete('a.jpg');
    expect(sent.map((command) => (command as { constructor: { name: string } }).constructor.name)).toEqual([
      'PutObjectCommand',
      'GetObjectCommand',
      'DeleteObjectCommand',
    ]);
  });
});
