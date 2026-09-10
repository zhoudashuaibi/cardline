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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountsService, type AccountFilter, type ListAccountsQuery } from './accounts.service';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller('admin/accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@Query() query: ListAccountsQuery) {
    return this.accounts.list(query);
  }

  @Get('export')
  async exportAccounts(@Query() query: Record<string, string>, @Res() response: Response) {
    const result = await this.accounts.exportAccounts({
      format: query.format,
      filename: query.filename,
      filter: {
        keyword: query.keyword,
        credits: query.credits,
        banStatus: query.banStatus,
        redeemStatus: query.redeemStatus,
        batchId: query.batchId,
        status: query.status,
      } as AccountFilter,
      limit: Number(query.limit) || 2000,
    });
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', contentDisposition(result.filename));
    response.send(result.content);
  }

  @Post('export')
  @HttpCode(200)
  async exportAccountsPost(@Body() body: Record<string, unknown>, @Res() response: Response) {
    const result = await this.accounts.exportAccounts({
      format: body?.format as string,
      filename: body?.filename as string,
      filter: (body?.filter || {}) as AccountFilter,
      ids: (body?.ids as number[]) || [],
      limit: Number(body?.limit) || 2000,
    });
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', contentDisposition(result.filename));
    response.send(result.content);
  }

  @Post('import')
  importAccounts(@Body() body: Record<string, unknown>) {
    return this.accounts.importAccounts({
      content: body?.content as string,
      files: body?.files as Array<{ name?: string; content?: string }>,
      prefix: body?.prefix as string,
      remark: body?.remark as string,
      source: body?.source as string,
      skipDuplicate: body?.skipDuplicate !== false,
      keyGroups: Number(body?.keyGroups) || 3,
      keyLength: Number(body?.keyLength) || 5,
    });
  }

  @Post('generate-cards')
  generateCards(@Body() body: Record<string, unknown>) {
    return this.accounts.generateCards({
      ids: (body?.ids as number[]) || [],
      prefix: body?.prefix as string,
      regenerate: body?.regenerate === true,
    });
  }

  @Post('batch-delete')
  batchDelete(@Body() body: { ids?: number[] }) {
    return this.accounts.batchDelete(body?.ids || []);
  }

  @Post('refresh-status')
  refreshStatus(@Body() body: Record<string, unknown>) {
    return this.accounts.refreshStatus({
      ids: (body?.ids as number[]) || [],
      filter: (body?.filter || {}) as AccountFilter,
      targets: (body?.targets as string[]) || [],
      limit: Number(body?.limit) || 100,
      cursor: body?.cursor === undefined ? undefined : Number(body.cursor),
    });
  }

  @Get(':id/mailbox')
  getMailbox(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: Record<string, string>,
  ) {
    return this.accounts.getMailbox(id, {
      maxMessages: Number(query.maxMessages) || 10,
      refresh: query.refresh,
    });
  }

  @Post(':id/copy-card')
  @HttpCode(200)
  copyCard(@Param('id', ParseIntPipe) id: number) {
    return this.accounts.copyCard(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.accounts.update(id, body || {});
  }
}
