import { Controller, Post, Get, Param, Query, UseGuards, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { FilesService, type UploadedFileInput } from './files.service.js';
import { UploadFileQueryDto } from './dto/upload-file.dto.js';
import { detectImageMime } from './image-bytes.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

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
  upload(
    @UploadedFile() file: UploadedFileInput,
    @Query() query: UploadFileQueryDto,
    @CurrentUser() userParam: CurrentUserParam,
  ) {
    const user = resolveAuthUser(userParam);
    return this.filesService.save(file, user, {
      purpose: query?.purpose,
      visibility: query?.visibility,
    });
  }

  /**
   * 下载文件（T159 加归属校验；T206 修正 expiresIn 分支绕过校验的越权）。
   *
   * 原先仅要求登录，任何已登录用户拿到 key 即可下载任意文件；
   * 现在 ADMIN 可取任意文件，其他角色仅可取自己上传的，越权一律 404
   * （不用 403，避免通过状态码差异探测 key 是否存在）。
   *
   * 注意：归属校验必须放在最前面 —— 签名 URL 分支（expiresIn）同样是一条读取路径，
   * 之前它先 return，导致非 ADMIN 用户可以用 ?expiresIn= 拿到他人文件的预签名地址。
   */
  @Get(':key')
  async getFile(
    @Param('key') key: string,
    @Query('expiresIn') expiresIn: string | undefined,
    @CurrentUser() userParam: CurrentUserParam,
    @Res() res: Response,
  ) {
    const user = resolveAuthUser(userParam);
    await this.filesService.assertCanRead(key, user);

    if (expiresIn !== undefined) {
      return res.json(await this.filesService.signUrl(key, Number(expiresIn) || 3600));
    }

    const body = await this.filesService.read(key);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', detectImageMime(body) ?? 'application/octet-stream');
    res.send(body);
  }
}
