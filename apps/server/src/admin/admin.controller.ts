import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountsService, type ListAccountsQuery } from '../accounts/accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, type AppSettings } from '../settings/settings.service';
import { bizError } from '../common/utils';

@Controller('admin/cards')
@UseGuards(JwtAuthGuard)
export class CardsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Query() query: ListAccountsQuery) {
    return this.accounts.listCards(query);
  }

  @Post('batch-disable')
  batchDisable(@Body() body: { ids?: number[] }) {
    return this.accounts.batchDisableCards(body?.ids || []);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: string; remark?: string }) {
    return this.accounts.updateCard(id, body || {});
  }
}

@Controller('admin/credit-tiers')
@UseGuards(JwtAuthGuard)
export class CreditTiersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const items = await this.prisma.creditTier.findMany({ orderBy: { sort: 'asc' } });
    return {
      items: items.map((item) => ({
        id: item.id,
        credits: item.credits,
        label: item.label,
        sort: item.sort,
      })),
    };
  }

  @Post()
  async create(@Body() body: { credits?: number; label?: string; sort?: number }) {
    const credits = Number(body?.credits);
    if (!Number.isFinite(credits) || credits <= 0) bizError('BAD_INPUT', '额度必须是正整数');

    const existing = await this.prisma.creditTier.findUnique({ where: { credits: Math.trunc(credits) } });
    if (existing) bizError('CONFLICT', `额度档位 ${credits} 已存在`);

    const max = await this.prisma.creditTier.aggregate({ _max: { sort: true } });
    const created = await this.prisma.creditTier.create({
      data: {
        credits: Math.trunc(credits),
        label: body?.label || `${Math.trunc(credits)} 额度`,
        sort: Number.isFinite(Number(body?.sort)) ? Number(body.sort) : (max._max.sort ?? 0) + 1,
      },
    });
    return { id: created.id, credits: created.credits, label: created.label, sort: created.sort };
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.creditTier.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('admin/settings')
@UseGuards(JwtAuthGuard)
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.getAll();
  }

  @Patch()
  update(@Body() body: Partial<AppSettings>) {
    return this.settings.update(body || {});
  }
}

@Controller('admin/stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('overview')
  overview() {
    return this.accounts.overview();
  }
}
