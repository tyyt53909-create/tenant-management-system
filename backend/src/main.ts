import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { resolveCorsOrigins } from './config/cors.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // CORS 白名单：从 CORS_ORIGINS 读取（逗号分隔），未配置时用本地开发默认值。
  // 详见 config/cors.config.ts —— 注意 localhost 与 127.0.0.1 属不同 origin。
  app.enableCors({
    origin: resolveCorsOrigins(process.env.CORS_ORIGINS),
    credentials: true,
  });
  
  // 全局路径前缀
  app.setGlobalPrefix('api');
  
  // 启用全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
