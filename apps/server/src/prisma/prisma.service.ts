import { INestApplication, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // SQLite 调优：PRAGMA 会返回结果集，必须用 queryRaw 且失败不能影响启动
    try {
      await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    } catch {
      /* 非 SQLite 或权限受限时忽略 */
    }
    try {
      await this.$queryRawUnsafe('PRAGMA busy_timeout = 8000;');
    } catch {
      /* 忽略 */
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
