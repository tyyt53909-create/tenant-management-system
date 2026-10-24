import { IsEnum, IsOptional } from 'class-validator';
import { FilePurpose, FileVisibility } from '@prisma/client';

/** 上传时可选的用途与可见性；PUBLIC 仅管理员可用（服务端再次校验）。 */
export class UploadFileQueryDto {
  @IsOptional()
  @IsEnum(FilePurpose, { message: '不支持的文件用途' })
  purpose?: FilePurpose;

  @IsOptional()
  @IsEnum(FileVisibility, { message: '不支持的文件可见性' })
  visibility?: FileVisibility;
}
