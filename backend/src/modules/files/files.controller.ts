import { Controller, Post, Get, Param, Query, UseGuards, UseInterceptors, UploadedFile, Res, NotFoundException } from '@nestjs/common';
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
  upload(@UploadedFile() file: any) {
    return this.filesService.save(file);
  }

  @Get(':key')
  async getFile(@Param('key') key: string, @Query('expiresIn') expiresIn: string | undefined, @Res() res: Response) {
    if (expiresIn !== undefined) {
      return res.json(this.filesService.signUrl(key, Number(expiresIn) || 3600));
    }
    try {
      return res.sendFile(this.filesService.filePath(key));
    } catch {
      throw new NotFoundException('文件不存在');
    }
  }
}
