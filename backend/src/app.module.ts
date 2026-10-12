import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import appConfig from './config/app.config.js';
import databaseConfig from './config/database.config.js';
import jwtConfig from './config/jwt.config.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RoomsModule } from './modules/rooms/rooms.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { BuildingsModule } from './modules/buildings/buildings.module.js';
import { ContractsModule } from './modules/contracts/contracts.module.js';
import { BillsModule } from './modules/bills/bills.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { MetersModule } from './modules/meters/meters.module.js';
import { PrepayModule } from './modules/prepay/prepay.module.js';
import { CheckoutModule } from './modules/checkout/checkout.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { AuditLogModule } from './modules/audit/audit.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    RoomsModule,
    TenantsModule,
    BuildingsModule,
    ContractsModule,
    BillsModule,
    MaintenanceModule,
    MetersModule,
    PrepayModule,
    CheckoutModule,
    NotificationsModule,
    FilesModule,
    AuditLogModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
