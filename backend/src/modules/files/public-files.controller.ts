import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { FilesService } from './files.service.js';
import { detectImageMime } from './image-bytes.js';

/**
 * 公开文件读取（SEC-07 / ISS-06）。
 *
 * 房源照片等 `visibility=PUBLIC` 的对象由匿名访客直接读取；私有对象与不存在一律 404，
 * 不通过状态码差异泄露对象键是否存在。缓存 1 小时，撤回公开后最多 1 小时生效。
 */
@Controller('public/files')
@Public()
export class PublicFilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get(':key')
  async getFile(@Param('key') key: string, @Res() res: Response) {
    const body = await this.filesService.readPublic(key);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', detectImageMime(body) ?? 'application/octet-stream');
    res.send(body);
  }
}
