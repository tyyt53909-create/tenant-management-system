import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createThrottleModuleOptions } from './config/throttle.config.js';
import { RedisModule } from './redis/redis.module.js';
import { RedisService } from './redis/redis.service.js';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import appConfig from './config/app.config.js';
import databaseConfig from './config/database.config.js';
import { validateEnvironment } from './config/env.validation.js';
import jwtConfig from './config/jwt.config.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RoomsModule } from './modules/rooms/rooms.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { PublicUtilitiesModule } from './modules/public-utilities/public-utilities.module.js';
import { ImportsModule } from './modules/imports/imports.module.js';
import { TagsModule } from './modules/tags/tags.module.js';
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
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { StatisticsModule } from './modules/statistics/statistics.module.js';
import { TenantCapabilitiesModule } from './modules/tenant-capabilities/tenant-capabilities.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig],
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: async (redis: RedisService) => {
        await redis.connect();
        return createThrottleModuleOptions(
          redis.ready && redis.client ? new RedisThrottlerStorage(redis.client) : undefined,
        );
      },
    }),
    PrismaModule,
    HealthModule,
    TenantCapabilitiesModule,
    AuthModule,
    RoomsModule,
    TenantsModule,
    PublicUtilitiesModule,
    ImportsModule,
    TagsModule,
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
    DashboardModule,
    SchedulerModule,
    // 公开看房：无鉴权，只暴露可租房源白名单字段（P1 / T155）
    PublicModule,
    // 统计：时间维度（月/季/年/自定义）× 空间维度（整楼/楼层），仅 ADMIN
    StatisticsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
