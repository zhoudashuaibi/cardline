import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

// Node 20.6+ 内置 .env 加载，避免额外依赖
function loadEnv(): void {
  if (process.env.DATABASE_URL && process.env.JWT_SECRET) return;
  const candidates = [
    join(process.cwd(), '.env'),
    join(__dirname, '..', '.env'),
    join(__dirname, '..', '..', '.env'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      /* 尝试下一个 */
    }
  }
}

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // 导入账号的 JSON 可能非常大（几百 MB 级别），放宽请求体上限
  app.useBodyParser('json', { limit: '128mb' });
  app.useBodyParser('urlencoded', { limit: '128mb', extended: true });

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN === '*' || !process.env.CORS_ORIGIN
      ? true
      : process.env.CORS_ORIGIN.split(',').map((item) => item.trim()),
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);

  const logger = new Logger('Bootstrap');
  logger.log(`卡密兑换系统后端已启动： http://${host}:${port}/api`);
}

void bootstrap();
