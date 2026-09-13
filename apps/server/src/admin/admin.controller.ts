import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountsService, type AccountFilter, type ListAccountsQuery } from '../accounts/accounts.service';
import { SettingsService, type AppSettings } from '../settings/settings.service';

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

  /** 批量复制卡密：传 `ids` 复制勾选行，或传 `filter` 复制筛选结果（跨分页） */
  @Post('copy-keys')
  @HttpCode(200)
  copyKeys(@Body() body: Record<string, unknown>) {
    return this.accounts.copyCards({
      ids: body?.ids,
      filter: (body?.filter || {}) as AccountFilter,
      limit: body?.limit,
    });
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: { status?: string; remark?: string }) {
    return this.accounts.updateCard(id, body || {});
  }
}

/**
 * 额度档位（只读）。
 *
 * 档位不是手工维护的字典：账号导入后由「邮箱取件命中额度关键字」自动定档
 * （档位 = 命中 credits ÷ 25，0 表示待定档）。这里只暴露实际存在的档位分布。
 */
@Controller('admin/credit-tiers')
@UseGuards(JwtAuthGuard)
export class CreditTiersController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list() {
    return this.accounts.tiers();
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
