import { Controller, Get, Post, Param, Request, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RequireCapability } from '../../common/decorators/require-capability.decorator.js';
import { CapabilityGuard } from '../../common/guards/capability.guard.js';
import { ContractAttachmentsService } from './contract-attachments.service.js';

@Controller('contracts/:id/attachments')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class ContractAttachmentsController {
  constructor(private readonly attachments: ContractAttachmentsService) {}

  @Get()
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.contract.read')
  list(@Param('id') id: string, @Request() req: any) { return this.attachments.list(id, req.user); }

  @Post()
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Param('id') id: string, @UploadedFile() file: any, @Request() req: any) { return this.attachments.upload(id, file, req.user); }

  @Get(':attachmentId/file')
  @Roles('ADMIN', 'TENANT')
  @RequireCapability('tenant.contract.read')
  async download(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @Request() req: any, @Res() res: Response) {
    const file = await this.attachments.file(id, attachmentId, req.user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.send(file.body);
  }
}
