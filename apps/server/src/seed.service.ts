import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma/prisma.service';
import { DEFAULT_SETTINGS } from './settings/settings.service';
import { SCHEMA_STATEMENTS } from './prisma/schema-statements';

const DEFAULT_TIERS = [5, 10, 20, 50, 100, 200, 500, 1000];

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger('Seed');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.ensureAdmin();
    await this.ensureTiers();
    await this.ensureSettings();
  }

  /**
   * 幂等建表：保证「克隆仓库 → npm install → npm run dev」即可直接使用，
   * Docker 镜像里也不必携带 Prisma CLI。
   */
  private async ensureSchema(): Promise<void> {
    try {
      for (const statement of SCHEMA_STATEMENTS) {
        await this.prisma.$executeRawUnsafe(statement);
      }
    } catch (error) {
      this.logger.error(
        `初始化表结构失败：${error instanceof Error ? error.message : error}（如使用 MySQL/PostgreSQL 请先执行 prisma migrate）`,
      );
    }
  }

  private async ensureAdmin(): Promise<void> {
    const count = await this.prisma.adminUser.count();
    if (count > 0) return;

    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    await this.prisma.adminUser.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: '管理员',
        role: 'admin',
      },
    });
    this.logger.log(`已创建默认后台账号：${username} / ${password}（请尽快修改密码）`);
  }

  private async ensureTiers(): Promise<void> {
    const count = await this.prisma.creditTier.count();
    if (count > 0) return;
    await this.prisma.creditTier.createMany({
      data: DEFAULT_TIERS.map((credits, index) => ({
        credits,
        label: `${credits} 额度`,
        sort: index,
      })),
    });
    this.logger.log(`已初始化额度档位：${DEFAULT_TIERS.join(', ')}`);
  }

  private async ensureSettings(): Promise<void> {
    const count = await this.prisma.setting.count();
    if (count > 0) return;
    await this.prisma.setting.createMany({
      data: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
        key,
        value: String(value),
      })),
    });
  }
}
