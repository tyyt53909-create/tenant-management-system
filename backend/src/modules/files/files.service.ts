import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import sharp from 'sharp';
import { createThumbnail, detectImageMime, type ImageMime } from './image-bytes.js';
import {
  createStorageAdapter,
  LocalStorage,
  type StorageAdapter,
  type StorageEnv,
} from './storage.adapter.js';

const ALLOWED_MIME = new Set<ImageMime>(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024;
const EXTENSION: Record<ImageMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export interface UploadedFileInput {
  buffer?: Buffer;
  mimetype?: string;
  size?: number;
  originalname?: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly storage: StorageAdapter;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.storage = createStorageAdapter(this.storageEnv());
  }

  /**
   * 保存上传文件并登记归属（T159）。
   * 存储驱动由 STORAGE_DRIVER 决定，业务调用不区分本地和 S3。
   * 同时写出一张去掉 EXIF 的缩略图。
   */
  async save(file: UploadedFileInput, actor?: { userId?: string; role?: string; tenantId?: string }) {
    if (!file) throw new BadRequestException('未收到文件');
    if (!file.mimetype || !ALLOWED_MIME.has(file.mimetype as ImageMime)) {
      throw new BadRequestException('仅支持 JPG/PNG/WebP');
    }
    if ((file.size ?? 0) > MAX_SIZE) {
      throw new BadRequestException('单张图片最大 10MB');
    }
    const body = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer ?? []);
    const detected = detectImageMime(body);
    if (!detected || detected !== file.mimetype) {
      throw new BadRequestException('文件内容不是有效的图片');
    }

    const extension = EXTENSION[detected];
    const key = `${Date.now()}-${randomUUID()}${extension || extname(file.originalname || '') || '.bin'}`;
    // 原图一律重编码以清除 EXIF（含 GPS）：此前只对 JPEG 处理，PNG/WebP 会原样落盘（T209）
    const stored = await this.stripMetadata(body, detected);
    await this.storage.put(key, stored, detected);

    let thumbnailKey: string | undefined;
    try {
      const thumb = await createThumbnail(body);
      thumbnailKey = key.replace(/\.[^.]+$/, '') + '.thumb.jpg';
      await this.storage.put(thumbnailKey, thumb, 'image/jpeg');
    } catch (error) {
      this.logger.warn(`缩略图生成失败：${key} ${(error as Error).message}`);
      thumbnailKey = undefined;
    }

    const url = `/api/files/${key}`;
    const thumbnail = thumbnailKey ? `/api/files/${thumbnailKey}` : undefined;
    await this.remember({
      key,
      url,
      fileName: file.originalname ?? null,
      fileSize: file.size ?? body.length,
      mimeType: detected,
      uploadedBy: actor?.userId ?? null,
      tenantId: actor?.tenantId ?? null,
    });
    if (thumbnailKey && thumbnail) {
      await this.remember({
        key: thumbnailKey,
        url: thumbnail,
        fileName: null,
        fileSize: 0,
        mimeType: 'image/jpeg',
        uploadedBy: actor?.userId ?? null,
        tenantId: actor?.tenantId ?? null,
      });
    }

    return {
      key,
      url,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: detected,
      thumbnail,
    };
  }

  async assertCanRead(key: string, actor?: { userId?: string; role?: string }) {
    if (actor?.role === 'ADMIN') return;

    const asset = await this.prisma.fileAsset.findUnique({
      where: { key },
      select: { uploadedBy: true },
    });

    if (!asset || !actor?.userId || asset.uploadedBy !== actor.userId) {
      throw new NotFoundException('文件不存在');
    }
  }

  filePath(key: string) {
    this.assertSafeKey(key);
    if (!(this.storage instanceof LocalStorage)) {
      throw new BadRequestException('当前存储驱动不提供本地路径');
    }
    return this.storage.path(key);
  }

  async read(key: string): Promise<Buffer> {
    this.assertSafeKey(key);
    try {
      return await this.storage.get(key);
    } catch {
      throw new NotFoundException('文件不存在');
    }
  }

  async signUrl(key: string, expiresInSeconds = 3600) {
    this.assertSafeKey(key);
    const url = await this.storage.signedUrl(key, expiresInSeconds);
    return { key, url, expiresIn: expiresInSeconds };
  }

  /**
   * 重编码以清除 EXIF/GPS 等元数据（sharp 默认不保留 metadata）。
   *
   * 三种允许的图片格式都要走这一步：手机相册的 PNG（eXIf chunk）与 WebP（EXIF chunk）
   * 同样会带定位信息，此前只处理 JPEG（T209）。
   *
   * 解不开的文件（magic bytes 像图片但内容不合法）按原样保存并留日志：宁可保留可用性，
   * 也不要把一个能存的文件变成 500；这类内容本身无法被当作图片渲染
   * （下载时带 `X-Content-Type-Options: nosniff`）。
   */
  private async stripMetadata(body: Buffer, format: ImageMime): Promise<Buffer> {
    try {
      const pipeline = sharp(body, { failOn: 'error' }).rotate();
      if (format === 'image/png') return await pipeline.png().toBuffer();
      if (format === 'image/webp') return await pipeline.webp().toBuffer();
      return await pipeline.jpeg({ quality: 90 }).toBuffer();
    } catch (error) {
      this.logger.warn(`图片元数据清理失败，按原样保存：${(error as Error).message}`);
      return body;
    }
  }

  private assertSafeKey(key: string) {
    if (key.includes('..') || key.includes('/') || key.includes('\\')) {
      throw new BadRequestException('非法的文件key');
    }
  }

  private async remember(data: {
    key: string;
    url: string;
    fileName: string | null;
    fileSize: number;
    mimeType: string;
    uploadedBy: string | null;
    tenantId: string | null;
  }) {
    try {
      await this.prisma.fileAsset.create({ data });
    } catch {
      this.logger.error(`文件归属登记失败，该文件将仅管理员可下载: ${data.key}`);
    }
  }

  private storageEnv(): StorageEnv {
    // ConfigService 本身会回退到 process.env，这里不必再手写 process.env 兜底
    const read = (name: string) => {
      const configured = this.configService.get<string>(name);
      return typeof configured === 'string' && configured.trim() ? configured.trim() : undefined;
    };
    return {
      STORAGE_DRIVER: read('STORAGE_DRIVER'),
      UPLOAD_DIR: read('UPLOAD_DIR'),
      S3_ENDPOINT: read('S3_ENDPOINT'),
      S3_REGION: read('S3_REGION'),
      OSS_REGION: read('OSS_REGION'),
      S3_BUCKET: read('S3_BUCKET'),
      OSS_BUCKET: read('OSS_BUCKET'),
      S3_ACCESS_KEY_ID: read('S3_ACCESS_KEY_ID'),
      OSS_ACCESS_KEY_ID: read('OSS_ACCESS_KEY_ID'),
      S3_SECRET_ACCESS_KEY: read('S3_SECRET_ACCESS_KEY'),
      OSS_ACCESS_KEY_SECRET: read('OSS_ACCESS_KEY_SECRET'),
      S3_FORCE_PATH_STYLE: read('S3_FORCE_PATH_STYLE'),
    };
  }
}
