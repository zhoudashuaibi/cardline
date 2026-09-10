import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RedeemService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly service: RedeemService) {}

  @Get('meta')
  meta() {
    return this.service.publicMeta();
  }

  @Post('redeem')
  redeem(@Body() body: Record<string, unknown>, @Req() request: Request) {
    return this.service.redeem({
      cards: body?.cards as string[],
      format: body?.format as string,
      limit: Number(body?.limit) || 1,
      ip: clientIp(request),
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('pickup/resolve')
  resolve(@Body() body: Record<string, unknown>) {
    return this.service.resolvePickup({
      input: body?.input as string,
      files: body?.files as Array<{ name?: string; content?: string }>,
    });
  }

  @Post('pickup/fetch')
  fetch(@Body() body: Record<string, unknown>) {
    return this.service.fetchPickup({
      records: body?.records as Array<{
        key?: string;
        email?: string;
        line?: string;
        fromCard?: string | null;
      }>,
      maxMessages: Number(body?.maxMessages) || undefined,
      query: body?.query as string,
    });
  }

  @Post('pickup/export')
  @HttpCode(200)
  async exportPickup(@Body() body: Record<string, unknown>, @Res() response: Response) {
    const kind = body?.kind === 'email' ? 'email' : 'line';
    const result =
      body?.category && body.category !== 'all'
        ? await this.service.exportPickupClassified({
            keys: body?.keys as string[],
            category: String(body.category),
          })
        : await this.service.exportPickup({ keys: body?.keys as string[], kind });
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename.replace(/[^\x20-\x7E]/g, '_')}"`,
    );
    response.send(result.content);
  }
}

function clientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.ip || request.socket?.remoteAddress || '';
}
