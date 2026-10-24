import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createThrottleModuleOptions } from './config/throttle.config.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
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
import { BusinessClockModule } from './common/business-clock/business-clock.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { RoomsModule } from './modules/rooms/rooms.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { PublicUtilitiesModule } from './modules/public-utilities/public-utilities.module.js';
import { ImportsModule } from './modules/imports/imports.module.js';
import { TagsModule } from './modules/tags/tags.module.js';
import { BuildingsModule } from './modules/buildings/buildings.module.js';
import { ContractsModule } from './modules/contracts/contracts.module.js';
import { BillsModule } from './modules/bills/bills.module.js';
import { DepositsModule } from './modules/deposits/deposits.module.js';
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
import { SettingsModule } from './modules/settings/settings.module.js';
import { MetricsModule } from './common/metrics/metrics.module.js';
import { AlertModule } from './common/alerts/alert.module.js';
import { TenantCapabilitiesModule } from './modules/tenant-capabilities/tenant-capabilities.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { FloorPlansModule } from './modules/floor-plans/floor-plans.module.js';
import { SpaceModule } from './modules/space/space.module.js';
import { StaffModule } from './modules/staff/staff.module.js';

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
    // 可观测性与告警（OPS-04 / T277）
    MetricsModule,
    AlertModule,
    BusinessClockModule,
    HealthModule,
    TenantCapabilitiesModule,
    AuthModule,
    StaffModule,
    RoomsModule,
    TenantsModule,
    PublicUtilitiesModule,
    ImportsModule,
    TagsModule,
    BuildingsModule,
    FloorPlansModule,
    SpaceModule,
    ContractsModule,
    BillsModule,
    DepositsModule,
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
    // 业务设置中心（FIN-11 / T276）：ADMIN 读写 + 审计
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // T257 / SEC-01：全域默认拒绝。未标注 @Public() 的路由一律要求有效 JWT；
    // RolesGuard 紧随其后，按 @Roles() 元数据校验角色（无元数据则放行）。
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
