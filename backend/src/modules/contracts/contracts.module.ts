import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service.js';
import { ContractsController } from './contracts.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FilesModule } from '../files/files.module.js';
import { ContractAttachmentsController } from './contract-attachments.controller.js';
import { ContractAttachmentsService } from './contract-attachments.service.js';

@Module({
  imports: [PrismaModule, FilesModule],
  controllers: [ContractsController, ContractAttachmentsController],
  providers: [ContractsService, ContractAttachmentsService],
  exports: [ContractsService],
})
export class ContractsModule {}
