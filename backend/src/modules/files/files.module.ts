import { Module } from '@nestjs/common';
import { FilesService } from './files.service.js';
import { FilesController } from './files.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
