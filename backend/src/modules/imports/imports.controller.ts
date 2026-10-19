import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { ImportsService, type ImportEntityKey } from './imports.service.js';
import { ImportCommitQueryDto, ImportPreviewQueryDto } from './dto/import-query.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, resolveAuthUser, type CurrentUserParam } from '../../common/decorators/current-user.decorator.js';

/** 导入文件上限：5000 行 CSV 通常在 1MB 以内 */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * 旧资料批量导入（T216，docs/00 §2.2）。
 *
 * 两步式：先 dryRun 预检并返回逐行错误，再以 dryRun=false 真正写入。
 * 文件在两次请求里各上传一次，换来的是「同一份文件两次结果一致」的简单契约。
 */
@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  /** 下载模板（UTF-8 BOM，Excel 直接打开不乱码） */
  @Get(':entity/template')
  template(@Param('entity') entity: string, @Res() res: Response) {
    const csv = this.importsService.template(entity as ImportEntityKey);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${entity}-template.csv"`);
    res.send(csv);
  }

  /** 预检：返回逐行错误与跳过数，不写库 */
  @Post(':entity/preview')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES } }))
  preview(
    @Param('entity') entity: string,
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Query() query: ImportPreviewQueryDto,
  ) {
    return this.importsService.preview(entity as ImportEntityKey, this.readContent(file), { buildingId: query.buildingId });
  }

  /**
   * 写入。默认 dryRun=true，只有显式传 dryRun=false 才真正落库——
   * 避免误调用一次 commit 就把数据写进去。
   */
  @Post(':entity/commit')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES } }))
  commit(
    @Param('entity') entity: string,
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @Query() query: ImportCommitQueryDto,
    @CurrentUser() userParam: CurrentUserParam,
    @Req() req: Request,
  ) {
    const user = resolveAuthUser(userParam);
    return this.importsService.commit(
      entity as ImportEntityKey,
      this.readContent(file),
      {
        userId: user.userId,
        ip: req.ip ?? 'unknown',
        userAgent: (req.headers['user-agent'] as string | undefined) ?? 'unknown',
      },
      { buildingId: query.buildingId, dryRun: query.dryRun },
    );
  }

  private readContent(file: { buffer?: Buffer } | undefined): string {
    if (!file?.buffer) {
      throw new BadRequestException('没有收到文件（字段名需为 file）');
    }
    return file.buffer.toString('utf8');
  }
}
