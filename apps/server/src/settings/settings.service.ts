import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AppSettings {
  siteName: string;
  siteSubtitle: string;
  pickupConcurrency: number;
  pickupMaxMessages: number;
  defaultFormat: string;
  redeemLimitPerCard: number;
  announcement: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  siteName: 'Cardline',
  siteSubtitle: 'SECURE DELIVERY',
  pickupConcurrency: 4,
  pickupMaxMessages: 30,
  defaultFormat: 'sub2api',
  redeemLimitPerCard: 1,
  announcement: '',
};

@Injectable()
export class SettingsService {
  private cache: AppSettings | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    const rows = await this.prisma.setting.findMany();
    const merged = { ...DEFAULT_SETTINGS } as unknown as Record<string, string | number>;
    for (const row of rows) {
      if (!(row.key in DEFAULT_SETTINGS)) continue;
      const current = merged[row.key];
      if (typeof current === 'number') {
        const num = Number(row.value);
        if (Number.isFinite(num)) merged[row.key] = num;
      } else {
        merged[row.key] = row.value;
      }
    }
    this.cache = merged as unknown as AppSettings;
    return this.cache;
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const entries = Object.entries(patch || {}).filter(
      ([key, value]) => key in DEFAULT_SETTINGS && value !== undefined && value !== null,
    );
    for (const [key, value] of entries) {
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) },
      });
    }
    this.cache = null;
    return this.getAll();
  }

  invalidate(): void {
    this.cache = null;
  }
}
