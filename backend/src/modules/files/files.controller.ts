import { Controller, Post, Get, Param, Query, UseGuards, UseInterceptors, UploadedFile, Res, Request, NotFoundException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { FilesService } from './files.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  // 上传时登记归属（T159）：actor 来自 JWT，不信任请求体
  upload(@UploadedFile() file: any, @Request() req: any) {
    return this.filesService.save(file, req.user);
  }

  /**
   * 下载文件（T159 加归属校验）。
   *
   * 原先仅要求登录，任何已登录用户拿到 key 即可下载任意文件；
   * 现在 ADMIN 可取任意文件，其他角色仅可取自己上传的，越权一律 404
   * （不用 403，避免通过状态码差异探测 key 是否存在）。
   */
  @Get(':key')
  async getFile(
    @Param('key') key: string,
    @Query('expiresIn') expiresIn: string | undefined,
    @Request() req: any,
    @Res() res: Response,
  ) {
    if (expiresIn !== undefined) {
      return res.json(this.filesService.signUrl(key, Number(expiresIn) || 3600));
    }

    await this.filesService.assertCanRead(key, req.user);

    try {
      return res.sendFile(this.filesService.filePath(key));
    } catch {
      throw new NotFoundException('文件不存在');
    }
  }
}
