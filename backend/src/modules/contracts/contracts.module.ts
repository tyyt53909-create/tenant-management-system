import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service.js';
import { ContractsController } from './contracts.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FilesModule } from '../files/files.module.js';
import { ContractAttachmentsController } from './contract-attachments.controller.js';
import { ContractAttachmentsService } from './contract-attachments.service.js';
import { ContractTemplatesController } from './contract-templates.controller.js';
import { ContractTemplatesService } from './contract-templates.service.js';
import { ContractRenewalsService } from './contract-renewals.service.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { ELECTRONIC_SIGN_PROVIDER } from './sign/electronic-sign-provider.interface.js';
import { MockElectronicSignProvider } from './sign/mock-electronic-sign.provider.js';

@Module({
  imports: [
    PrismaModule,
    FilesModule,
    SettingsModule,
    SchedulerModule,
    NotificationsModule,
  ],
  controllers: [
    ContractsController,
    ContractAttachmentsController,
    ContractTemplatesController,
  ],
  providers: [
    ContractsService,
    ContractAttachmentsService,
    ContractTemplatesService,
    ContractRenewalsService,
    CryptoService,
    {
      provide: ELECTRONIC_SIGN_PROVIDER,
      useClass: MockElectronicSignProvider,
    },
  ],
  exports: [ContractsService, ContractTemplatesService, ContractRenewalsService, ELECTRONIC_SIGN_PROVIDER],
})
export class ContractsModule {}
