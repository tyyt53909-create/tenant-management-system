import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB，与待确认清单一致

@Injectable()
export class FilesService {
  private readonly uploadDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
  }

  /**
   * 保存上传文件并**登记归属**（T159 安全修复）。
   *
   * actor 来自 JWT（服务端注入），不信任客户端传参。
   * 归属信息用于后续 GET /files/:key 的授权校验。
   */
  async save(file: any, actor?: { userId?: string; role?: string; tenantId?: string }) {
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

    const url = `/api/files/${key}`;

    // 登记归属；登记失败不应阻断上传（文件已落盘），但会记入日志便于排查
    try {
      await this.prisma.fileAsset.create({
        data: {
          key,
          url,
          fileName: file.originalname ?? null,
          fileSize: file.size ?? 0,
          mimeType: file.mimetype ?? null,
          uploadedBy: actor?.userId ?? null,
          tenantId: actor?.tenantId ?? null,
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[files] 文件归属登记失败，该文件将仅管理员可下载:', key, error);
    }

    return {
      key,
      url,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
    };
  }

  /**
   * 下载授权（T159）。
   *
   * 规则：
   * - ADMIN：可取任意文件（看房/报修处理等场景需要）
   * - 其他角色：仅可取**自己上传**的文件；
   *   key 不存在归属记录（历史文件或登记失败的）一律拒绝
   *
   * 拒绝时抛 404 而非 403 —— 避免通过状态码差异探测「key 是否存在」。
   */
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
