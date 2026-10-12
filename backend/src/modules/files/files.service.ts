import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname } from 'path';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB，与待确认清单一致

@Injectable()
export class FilesService {
  private readonly uploadDir: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
  }

  async save(file: any) {
    if (!file) throw new BadRequestException('未收到文件');
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG/PNG/WebP');
    }
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('单张图片最大 10MB');
    }

    await fs.mkdir(this.uploadDir, { recursive: true });
    const key = `${Date.now()}-${randomUUID()}${extname(file.originalname || '') || '.bin'}`;
    await fs.writeFile(join(this.uploadDir, key), file.buffer);

    return {
      key,
      url: `/api/files/${key}`,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
    };
  }

  filePath(key: string) {
    if (key.includes('..') || key.includes('/')) {
      throw new BadRequestException('非法的文件key');
    }
    return join(this.uploadDir, key);
  }

  signUrl(key: string, expiresInSeconds = 3600) {
    void this.configService;
    return { key, url: `/api/files/${key}`, expiresIn: expiresInSeconds };
  }
}
