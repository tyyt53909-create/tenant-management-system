import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FilesService, type UploadedFileInput } from '../files/files.service.js';
import { isUtf8 } from 'node:buffer';
import { extname } from 'node:path';

export interface ContractFileActor { userId?: string; role?: string; tenantId?: string }

@Injectable()
export class ContractAttachmentsService {
  constructor(private readonly prisma: PrismaService, private readonly files: FilesService) {}

  private async assertAccess(contractId: string, actor: ContractFileActor) {
    if (!actor.userId || !['ADMIN', 'TENANT'].includes(actor.role || '') || (actor.role === 'TENANT' && !actor.tenantId)) {
      throw new NotFoundException('合同不存在');
    }
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId }, select: { id: true, tenantId: true } });
    if (!contract || (actor.role === 'TENANT' && contract.tenantId !== actor.tenantId)) throw new NotFoundException('合同不存在');
  }

  async list(contractId: string, actor: ContractFileActor) {
    await this.assertAccess(contractId, actor);
    const attachments = await this.prisma.contractAttachment.findMany({
      where: { contractId, type: 'CONTRACT_SCAN' }, orderBy: { createdAt: 'asc' },
      select: { id: true, fileName: true, fileSize: true, mimeType: true, createdAt: true },
    });
    return attachments.map(item => ({ ...item, downloadUrl: `/api/contracts/${encodeURIComponent(contractId)}/attachments/${encodeURIComponent(item.id)}/file` }));
  }

  async upload(contractId: string, file: UploadedFileInput, actor: ContractFileActor) {
    if (actor.role !== 'ADMIN') throw new NotFoundException('合同不存在');
    await this.assertAccess(contractId, actor);
    if (!file?.buffer || !file.mimetype || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('合同图片仅支持 JPG、PNG、WebP');
    const data: Buffer = file.buffer;
    const valid = file.mimetype === 'image/png'
      ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : file.mimetype === 'image/jpeg'
        ? data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        : data.length >= 12 && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
    if (!valid) throw new BadRequestException('文件内容不是有效的合同图片');
    // multipart 的文件名常被 Multer 按 latin1 解码，恢复 UTF-8 中文名。
    let fileName = String(file.originalname || '合同图片');
    if ([...fileName].every(character => character.charCodeAt(0) <= 255)) {
      const bytes = Buffer.from(fileName, 'latin1');
      if (isUtf8(bytes)) fileName = bytes.toString('utf8');
    }
    const allowedExtensions = file.mimetype === 'image/jpeg' ? ['.jpg', '.jpeg'] : file.mimetype === 'image/png' ? ['.png'] : ['.webp'];
    const extension = extname(fileName).toLowerCase();
    if (extension && !allowedExtensions.includes(extension)) throw new BadRequestException('文件扩展名与图片格式不匹配');
    // 避免 PNG 以 .html 等扩展名写盘后，被通用下载路由作为 HTML 解释。
    const saved = await this.files.save({ ...file, originalname: extension ? fileName : `${fileName}${allowedExtensions[0]}` }, actor);
    const attachment = await this.prisma.contractAttachment.create({ data: {
      contractId, type: 'CONTRACT_SCAN', fileName, fileUrl: saved.url,
      fileSize: saved.fileSize ?? file.size ?? 0, mimeType: saved.mimeType, uploadedBy: actor.userId!,
    } });
    return { id: attachment.id, fileName: attachment.fileName, fileSize: attachment.fileSize, mimeType: attachment.mimeType,
      createdAt: attachment.createdAt, downloadUrl: `/api/contracts/${encodeURIComponent(contractId)}/attachments/${encodeURIComponent(attachment.id)}/file` };
  }

  async file(contractId: string, attachmentId: string, actor: ContractFileActor) {
    await this.assertAccess(contractId, actor);
    const attachment = await this.prisma.contractAttachment.findFirst({ where: { id: attachmentId, contractId, type: 'CONTRACT_SCAN' } });
    if (!attachment || !['image/jpeg', 'image/png', 'image/webp'].includes(attachment.mimeType)) throw new NotFoundException('合同图片不存在');
    const match = /^\/api\/files\/([A-Za-z0-9._-]+)$/.exec(attachment.fileUrl);
    if (!match || match[1]!.includes('..')) throw new NotFoundException('合同图片不存在');
    const body = await this.files.read(match[1]!);
    return { body, mimeType: attachment.mimeType, fileName: attachment.fileName };
  }
}
