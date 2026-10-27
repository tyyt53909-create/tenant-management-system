import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FilePurpose, FileVisibility } from '@prisma/client';
import sharp from 'sharp';
import { createThumbnail, detectImageMime, type ImageMime } from './image-bytes.js';
import {
  createStorageAdapter,
  LocalStorage,
  type StorageAdapter,
  type StorageEnv,
} from './storage.adapter.js';

const ALLOWED_MIME = new Set<ImageMime>(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_SIGNED_URL_SECONDS = 3600;

/** 预签名有效期由调用方传入，必须封顶，避免签发数年有效的对象地址。 */
export function clampSignedUrlExpiry(raw: string | number | undefined): number {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return MAX_SIGNED_URL_SECONDS;
  return Math.min(Math.floor(parsed), MAX_SIGNED_URL_SECONDS);
}
const PURPOSES = new Set<FilePurpose>([
  'ROOM_PHOTO',
  'CONTRACT',
  'MAINTENANCE',
  'AVATAR',
  'RECEIPT',
  'OTHER',
]);
const VISIBILITIES = new Set<FileVisibility>(['PRIVATE', 'PUBLIC']);
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

export interface FileSaveOptions {
  purpose?: string;
  visibility?: string;
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
  async save(
    file: UploadedFileInput,
    actor?: { userId?: string; role?: string; tenantId?: string },
    options: FileSaveOptions = {},
  ) {
    if (!file) throw new BadRequestException('未收到文件');

    const purpose = this.resolvePurpose(options.purpose);
    const visibility = this.resolveVisibility(options.visibility, actor?.role);
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

    const url = visibility === 'PUBLIC' ? `/api/public/files/${key}` : `/api/files/${key}`;
    const thumbnail = thumbnailKey
      ? visibility === 'PUBLIC'
        ? `/api/public/files/${thumbnailKey}`
        : `/api/files/${thumbnailKey}`
      : undefined;
    const asset = await this.remember({
      key,
      url,
      fileName: file.originalname ?? null,
      fileSize: file.size ?? body.length,
      mimeType: detected,
      thumbnailKey: thumbnailKey ?? null,
      purpose,
      visibility,
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
        thumbnailKey: null,
        purpose,
        visibility,
        uploadedBy: actor?.userId ?? null,
        tenantId: actor?.tenantId ?? null,
      });
    }

    return {
      id: asset?.id ?? null,
      key,
      url,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: detected,
      thumbnail,
      purpose,
      visibility,
    };
  }

  async assertCanRead(
    key: string,
    actor?: { userId?: string; role?: string; tenantId?: string },
  ) {
    if (actor?.role === 'ADMIN') return;

    const asset = await this.prisma.fileAsset.findUnique({
      where: { key },
      select: { uploadedBy: true, tenantId: true },
    });

    const sameTenant =
      !!asset?.tenantId && !!actor?.tenantId && asset.tenantId === actor.tenantId;
    if (!asset || (!sameTenant && (!actor?.userId || asset.uploadedBy !== actor.userId))) {
      throw new NotFoundException('文件不存在');
    }
  }

  /** 匿名公开读取：只有 visibility=PUBLIC 的对象可读，其余一律 404。 */
  async readPublic(key: string): Promise<Buffer> {
    this.assertSafeKey(key);
    const asset = await this.prisma.fileAsset.findUnique({
      where: { key },
      select: { visibility: true },
    });
    if (!asset || asset.visibility !== 'PUBLIC') {
      throw new NotFoundException('文件不存在');
    }
    return this.read(key);
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

  async signUrl(key: string, expiresInSeconds = MAX_SIGNED_URL_SECONDS) {
    this.assertSafeKey(key);
    const expiresIn = clampSignedUrlExpiry(expiresInSeconds);
    const url = await this.storage.signedUrl(key, expiresIn);
    return { key, url, expiresIn };
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
    thumbnailKey: string | null;
    purpose: FilePurpose;
    visibility: FileVisibility;
  }): Promise<{ id: string } | null> {
    try {
      return await this.prisma.fileAsset.create({
        data,
        select: { id: true },
      });
    } catch {
      this.logger.error(`文件归属登记失败，该文件将仅管理员可下载: ${data.key}`);
      return null;
    }
  }

  private resolvePurpose(raw: string | undefined): FilePurpose {
    if (raw === undefined || raw.trim() === '') return 'OTHER';
    const value = raw.trim().toUpperCase() as FilePurpose;
    if (!PURPOSES.has(value)) {
      throw new BadRequestException('不支持的文件用途');
    }
    return value;
  }

  private resolveVisibility(raw: string | undefined, role: string | undefined): FileVisibility {
    if (raw === undefined || raw.trim() === '') return 'PRIVATE';
    const value = raw.trim().toUpperCase() as FileVisibility;
    if (!VISIBILITIES.has(value)) {
      throw new BadRequestException('不支持的文件可见性');
    }
    if (value === 'PUBLIC' && role !== 'ADMIN') {
      throw new ForbiddenException('只有管理员可以上传公开文件');
    }
    return value;
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
