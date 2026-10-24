import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { configureSecurityAndMiddleware } from './config/security.config.js';
import { loadBootstrapConfig } from './config/bootstrap.config.js';
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  registerShutdownWatchdog,
} from './config/shutdown.config.js';
import { AllExceptionsFilter, requestIdMiddleware } from './common/filters/all-exceptions.filter.js';
import { createHttpLogger } from './logging/http-logger.js';
import { mountOpenApi } from './openapi/openapi.document.js';
import { AlertService } from './common/alerts/alert.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 启动期配置集中由 config 层读取（`src/` 其他位置不再直接读 process.env，见 OPT-07）。
  // 必须在 create() 之后：ConfigModule 是在模块初始化时才把 `.env` 载入 process.env 的，
  // 提前读会漏掉 .env 里的 PORT / CORS_ORIGINS / LOG_LEVEL / TRUST_PROXY。
  const config = loadBootstrapConfig();

  // 安全响应头与 Cookie 解析
  configureSecurityAndMiddleware(app);

  // CORS 白名单：来自 CORS_ORIGINS（逗号分隔），未配置时用本地开发默认值。
  // 详见 config/cors.config.ts —— 注意 localhost 与 127.0.0.1 属不同 origin。
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  // 全局路径前缀
  app.setGlobalPrefix('api');
  app.use(createHttpLogger(config.logLevel));
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter(config.nodeEnv, app.get(AlertService)));

  if (config.trustProxy !== false) {
    app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);
  }

  // 启用全局验证管道
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  mountOpenApi(app, { enabled: !config.isProduction });

  // SIGTERM/SIGINT 由 Nest 处理：依次关闭 HTTP server、定时任务与各模块的
  // onModuleDestroy（Prisma、Redis）。看门狗只负责「关不完就强制退出」。
  app.enableShutdownHooks();
  registerShutdownWatchdog(process, {
    timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
    logger: new Logger('Shutdown'),
    exit: (code) => process.exit(code),
  });

  await app.listen(config.port);
}
await bootstrap();
