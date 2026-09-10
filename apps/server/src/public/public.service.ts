import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConvertService } from '../convert/convert.service';
import { MailboxService } from '../mailbox/mailbox.service';
import { SettingsService } from '../settings/settings.service';
import { FORMAT_META } from '../common/error-codes';
import { isPendingTier, tierFromMailCredits } from '../common/credits';
import {
  looksEmail,
  normalizeCardKey,
  safeFilename,
  splitTokens,
} from '../common/utils';
import type { NormalizedAccount } from '../convert/convert.types';
import type { MailboxCredential, PickupResult } from '../mailbox/mailbox.types';
import type { Account } from '@prisma/client';

const MAX_CARDS = 500;
const MAX_PICKUP_RECORDS = 20;

export interface ResolvedRecord {
  key: string;
  email: string;
  source: 'line' | 'json' | 'card' | 'email';
  complete: boolean;
  fromCard: string | null;
  credits: number | null;
  accountId: number | null;
  label: string;
  error: string | null;
}

type AccountWithMailbox = Account & { mailbox: any };

@Injectable()
export class RedeemService {
  private readonly logger = new Logger(RedeemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly convert: ConvertService,
    private readonly mailbox: MailboxService,
    private readonly settings: SettingsService,
  ) {}

  // -------------------------------------------------------------------------
  // 前台元信息
  // -------------------------------------------------------------------------

  async publicMeta() {
    const settings = await this.settings.getAll();
    const grouped = await this.prisma.account.groupBy({
      by: ['credits', 'redeemStatus', 'banStatus', 'cardDisabled'],
      _count: { _all: true },
    });

    const byCreditsMap = new Map<
      number,
      { credits: number; total: number; available: number; redeemed: number }
    >();
    const ensure = (credits: number) => {
      if (!byCreditsMap.has(credits)) {
        byCreditsMap.set(credits, { credits, total: 0, available: 0, redeemed: 0 });
      }
      return byCreditsMap.get(credits)!;
    };

    let total = 0;
    let available = 0;
    let redeemed = 0;
    for (const group of grouped) {
      const count = group._count._all;
      total += count;
      // 待定档（额度 0）不对外展示，也不算可售
      if (isPendingTier(group.credits)) continue;

      const entry = ensure(group.credits);
      entry.total += count;
      const usable =
        group.redeemStatus === 'unredeemed' &&
        group.banStatus !== 'banned' &&
        group.banStatus !== 'invalid' &&
        !group.cardDisabled;
      if (usable) {
        entry.available += count;
        available += count;
      }
      if (group.redeemStatus === 'redeemed') {
        entry.redeemed += count;
        redeemed += count;
      }
    }

    const byCredits = [...byCreditsMap.values()].sort((a, b) => a.credits - b.credits);

    return {
      siteName: settings.siteName,
      siteSubtitle: settings.siteSubtitle,
      announcement: settings.announcement,
      formats: (['sub2api', 'cpa', 'email'] as const).map((value) => ({
        value,
        label: FORMAT_META[value].label,
        ext: FORMAT_META[value].ext,
        hint: FORMAT_META[value].hint,
      })),
      /** 在售档位（= 账号实际额度，由邮箱取件命中关键字自动定档，非手工维护） */
      creditTiers: byCredits.filter((item) => item.available > 0).map((item) => item.credits),
      defaultFormat: settings.defaultFormat,
      redeemLimitPerCard: settings.redeemLimitPerCard,
      stats: {
        total,
        available,
        redeemed,
        byCredits,
      },
      pickup: {
        enabled: true,
        direct: true,
        maxRecords: MAX_PICKUP_RECORDS,
        maxMessages: settings.pickupMaxMessages,
      },
    };
  }

  // -------------------------------------------------------------------------
  // 卡密兑换
  // -------------------------------------------------------------------------

  async redeem(payload: {
    cards?: unknown;
    format?: string;
    limit?: number;
    ip?: string;
    userAgent?: string;
  }) {
    const settings = await this.settings.getAll();
    const format = ['sub2api', 'cpa', 'email'].includes(String(payload?.format))
      ? String(payload.format)
      : settings.defaultFormat || 'sub2api';

    const raw = Array.isArray(payload?.cards) ? payload.cards : [payload?.cards];
    let cards = [
      ...new Set(
        raw
          .flatMap((item) => splitTokens(item))
          .map((item) => normalizeCardKey(item))
          .filter(Boolean),
      ),
    ];
    if (cards.length > MAX_CARDS) {
      this.logger.warn(`单次提交卡密数量超限（${cards.length}），已截断为 ${MAX_CARDS}`);
      cards = cards.slice(0, MAX_CARDS);
    }

    if (!cards.length) {
      return {
        format,
        results: [],
        summary: { total: 0, success: 0, failed: 0, credits: 0, accounts: 0 },
      };
    }

    const limit = Math.min(20, Math.max(1, Number(payload?.limit) || settings.redeemLimitPerCard || 1));

    const results: Array<Record<string, unknown>> = [];
    let successCount = 0;
    let failedCount = 0;
    let creditsSum = 0;
    let accountCount = 0;

    for (const cardKey of cards) {
      const result = await this.redeemOne(cardKey, format, limit, payload?.ip, payload?.userAgent);
      results.push(result);
      if (result.ok) {
        successCount++;
        creditsSum += Number(result.credits) || 0;
        accountCount += Number(result.accountCount) || 0;
      } else {
        failedCount++;
      }
    }

    return {
      format,
      results,
      summary: {
        total: cards.length,
        success: successCount,
        failed: failedCount,
        credits: creditsSum,
        accounts: accountCount,
      },
    };
  }

  private async redeemOne(
    cardKey: string,
    format: string,
    limit: number,
    ip?: string,
    userAgent?: string,
  ): Promise<Record<string, unknown>> {
    const account = (await this.prisma.account.findUnique({
      where: { cardKey },
      include: { mailbox: true },
    })) as AccountWithMailbox | null;

    const fail = (code: string, message: string): Record<string, unknown> => ({
      card: cardKey,
      ok: false,
      code,
      message,
      credits: null,
      accountCount: 0,
      redeemedAt: null,
      firstRedeem: false,
      filename: null,
      content: null,
      accounts: [],
    });

    if (!account) {
      await this.log(cardKey, null, 0, format, false, 'CARD_INVALID', ip, userAgent);
      return fail('CARD_INVALID', '卡密不存在');
    }
    if (account.cardDisabled) {
      await this.log(cardKey, account.id, account.credits, format, false, 'CARD_DISABLED', ip, userAgent);
      return fail('CARD_DISABLED', '该卡密已被停用');
    }
    // 待定档：账号额度还没从邮箱取件里定出来，不进兑换池（避免按错误档位交付）
    if (isPendingTier(account.credits)) {
      await this.log(cardKey, account.id, account.credits, format, false, 'CREDITS_PENDING', ip, userAgent);
      return fail('CREDITS_PENDING', '该卡密账号额度待定（邮箱取件尚未命中额度），请稍后重试');
    }
    if (account.banStatus === 'banned') {
      await this.log(cardKey, account.id, account.credits, format, false, 'NO_STOCK', ip, userAgent);
      return fail('NO_STOCK', '该卡密对应账号已封禁，请联系管理员');
    }

    // 首次兑换：尝试抢占账号（redeemStatus: unredeemed → redeemed 的原子更新即锁）
    let isFirstRedeem = false;
    let finalAccount = account;

    const claimed = await this.prisma.account.updateMany({
      where: { id: account.id, redeemStatus: 'unredeemed' },
      data: {
        redeemStatus: 'redeemed',
        redeemedAt: new Date(),
        redeemCount: { increment: 1 },
      },
    });

    if (claimed.count === 1) {
      isFirstRedeem = true;
    } else {
      // 已兑换过：本卡不再消耗新账号，只允许切换格式重复导出
      await this.prisma.account.update({
        where: { id: account.id },
        data: { redeemCount: { increment: 1 } },
      });
    }

    // 同一额度下的可用账号数量（首次兑换时用于 limit 扩展）
    const verified = (await this.prisma.account.findUnique({
      where: { id: account.id },
      include: { mailbox: true },
    })) as AccountWithMailbox;

    const accounts: AccountWithMailbox[] = [verified];
    if (isFirstRedeem && limit > 1) {
      const extra = (await this.prisma.account.findMany({
        where: {
          id: { not: account.id },
          credits: account.credits,
          redeemStatus: 'unredeemed',
          banStatus: { notIn: ['banned', 'invalid'] },
          cardDisabled: false,
        },
        include: { mailbox: true },
        orderBy: { id: 'asc' },
        take: limit - 1,
      })) as AccountWithMailbox[];
      accounts.push(...extra);
    }

    const normalized = accounts.map((item) => this.toNormalized(item));
    const content = this.convert.buildDeliverContent(format, normalized);
    const filename = `${safeFilename(cardKey, 'card')}.${
      FORMAT_META[format as keyof typeof FORMAT_META]?.ext || 'json'
    }`;

    await this.log(cardKey, account.id, account.credits, format, true, 'OK', ip, userAgent);

    return {
      card: cardKey,
      ok: true,
      code: 'OK',
      message: isFirstRedeem ? '兑换成功' : '已兑换过，本次为同账号重新导出',
      credits: account.credits,
      accountCount: accounts.length,
      redeemedAt: (verified.redeemedAt || new Date()).toISOString(),
      firstRedeem: isFirstRedeem,
      filename,
      content,
      accounts: accounts.map((item) => ({
        id: item.id,
        name: item.name,
        credits: item.credits,
        planType: item.planType,
        email: item.email,
      })),
    };
  }

  private toNormalized(account: AccountWithMailbox): NormalizedAccount {
    let raw: Record<string, unknown> | undefined;
    if (account.rawJson) {
      try {
        const parsed = JSON.parse(account.rawJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed;
      } catch {
        raw = undefined;
      }
    }
    const mailbox: MailboxCredential | undefined = account.mailbox?.email
      ? {
          email: account.mailbox.email,
          provider: account.mailbox.provider || 'outlook',
          authType: account.mailbox.authType || 'oauth2',
          password: account.mailbox.password || undefined,
          clientId: account.mailbox.clientId || undefined,
          refreshToken: account.mailbox.refreshToken || undefined,
          imapHost: account.mailbox.imapHost || 'outlook.office365.com',
          imapPort: account.mailbox.imapPort || 993,
          line:
            account.mailbox.line ||
            [
              account.mailbox.email,
              account.mailbox.password || '',
              account.mailbox.clientId || '',
              account.mailbox.refreshToken || '',
            ].join('----'),
        }
      : account.email && looksEmail(account.email)
        ? { email: account.email, provider: 'outlook', authType: 'oauth2' }
        : undefined;

    return {
      name: account.name,
      email: account.email || undefined,
      planType: account.planType || undefined,
      accountId: account.accountId || undefined,
      userId: account.userId || undefined,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken || undefined,
      idToken: account.idToken || undefined,
      sessionToken: account.sessionToken || undefined,
      expiresAt: account.expiresAt ? account.expiresAt.toISOString() : undefined,
      accessTokenExpiresAt: account.expiresAt ? Math.trunc(account.expiresAt.getTime() / 1000) : undefined,
      rawSource: (account.rawSource as 'sub2api' | 'cpa') || 'sub2api',
      raw,
      mailbox,
    };
  }

  private async log(
    cardKey: string,
    accountId: number | null,
    credits: number,
    format: string,
    success: boolean,
    message: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.redeemLog.create({
        data: {
          cardKey,
          accountId: accountId ?? undefined,
          credits: Number(credits) || 0,
          format,
          success,
          message,
          ip: ip || null,
          userAgent: userAgent ? String(userAgent).slice(0, 250) : null,
        },
      });
    } catch (error) {
      this.logger.warn(`写入兑换日志失败：${error instanceof Error ? error.message : error}`);
    }
  }

  // -------------------------------------------------------------------------
  // 取件：解析
  // -------------------------------------------------------------------------

  async resolvePickup(payload: { input?: string; files?: Array<{ name?: string; content?: string }> }) {
    const textBlocks: string[] = [];
    if (payload?.input && String(payload.input).trim()) textBlocks.push(String(payload.input));
    for (const file of payload?.files || []) {
      if (file?.content && String(file.content).trim()) textBlocks.push(String(file.content));
    }

    const records = new Map<string, ResolvedRecord>();
    const unknown: string[] = [];

    const addRecord = (record: ResolvedRecord): void => {
      const existing = records.get(record.key);
      if (!existing || (!existing.complete && record.complete)) records.set(record.key, record);
    };

    for (const block of textBlocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      // 整体 JSON（sub2api / CPA / 数组）
      const parsedWhole = tryJson(trimmed);
      if (parsedWhole !== undefined) {
        this.collectFromJson(parsedWhole, addRecord);
        continue;
      }

      for (const rawLine of trimmed.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const parsedLine = tryJson(line);
        if (parsedLine !== undefined) {
          this.collectFromJson(parsedLine, addRecord);
          continue;
        }

        if (line.includes('----')) {
          const credential = this.mailbox.parseCredential(line);
          if (credential?.email) {
            addRecord(this.recordFromCredential(credential, 'line'));
          } else {
            unknown.push(line);
          }
          continue;
        }

        // 卡密（形如 CARD-XXXXX-XXXXX-XXXXX）
        if (/^[A-Z0-9]{3,12}(-[A-Z0-9]{3,12}){2,4}$/.test(line)) {
          const cardKey = normalizeCardKey(line);
          const account = (await this.prisma.account.findUnique({
            where: { cardKey },
            include: { mailbox: true },
          })) as AccountWithMailbox | null;
          if (account) {
            const credential = this.credentialOf(account);
            addRecord({
              key: (credential?.email || account.email || account.name).toLowerCase(),
              email: credential?.email || account.email || account.name,
              source: 'card',
              complete: this.mailbox.isComplete(credential),
              fromCard: cardKey,
              credits: isPendingTier(account.credits) ? null : account.credits,
              accountId: account.id,
              label: '卡密',
              error: this.mailbox.isComplete(credential)
                ? null
                : '卡密对应的账号缺少完整取件凭据（client_id / refresh_token）',
            });
            continue;
          }
          unknown.push(line);
          continue;
        }

        if (looksEmail(line)) {
          const email = line.toLowerCase();
          const account = (await this.prisma.account.findFirst({
            where: { email },
            include: { mailbox: true },
          })) as AccountWithMailbox | null;
          const credential = account ? this.credentialOf(account) : this.mailbox.parseCredential(email);
          addRecord({
            key: email,
            email,
            source: account ? 'card' : 'email',
            complete: this.mailbox.isComplete(credential),
            fromCard: account?.cardKey ?? null,
            credits: account && !isPendingTier(account.credits) ? account.credits : null,
            accountId: account?.id ?? null,
            label: account ? '邮箱（已匹配账号）' : '仅邮箱',
            error: this.mailbox.isComplete(credential)
              ? null
              : '缺少取件凭据（密码 / client_id / refresh_token）',
          });
          continue;
        }

        unknown.push(line);
      }
    }

    const list = [...records.values()];
    return {
      records: list,
      summary: {
        total: list.length,
        complete: list.filter((item) => item.complete).length,
        incomplete: list.filter((item) => !item.complete).length,
        unknown: unknown.length,
      },
      unknown: unknown.slice(0, 50),
    };
  }

  private recordFromCredential(
    credential: MailboxCredential,
    source: ResolvedRecord['source'],
  ): ResolvedRecord {
    return {
      key: credential.email.toLowerCase(),
      email: credential.email,
      source,
      complete: this.mailbox.isComplete(credential),
      fromCard: null,
      credits: null,
      accountId: null,
      label: source === 'json' ? 'JSON' : '凭据行',
      error: this.mailbox.isComplete(credential)
        ? null
        : '凭据不完整，需要 邮箱----密码----clientid----refresh_token',
    };
  }

  private collectFromJson(parsed: unknown, addRecord: (record: ResolvedRecord) => void): void {
    const result = this.convert.parseAccounts(JSON.stringify(parsed), 'pickup-input');
    for (const item of result.items) {
      const credential = item.account.mailbox;
      if (credential?.email) {
        addRecord(
          this.recordFromCredential(
            {
              provider: 'outlook',
              authType: 'oauth2',
              ...credential,
              email: credential.email,
            },
            'json',
          ),
        );
      } else if (item.account.email && looksEmail(item.account.email)) {
        const email = item.account.email.toLowerCase();
        addRecord({
          key: email,
          email,
          source: 'json',
          complete: false,
          fromCard: null,
          credits: null,
          accountId: null,
          label: 'JSON',
          error: 'JSON 中缺少邮箱取件凭据（client_id / refresh_token）',
        });
      }
    }
  }

  private credentialOf(account: AccountWithMailbox): MailboxCredential | null {
    if (account.mailbox?.email) {
      return this.mailbox.parseCredential({
        email: account.mailbox.email,
        provider: account.mailbox.provider,
        authType: account.mailbox.authType,
        password: account.mailbox.password,
        clientId: account.mailbox.clientId,
        refreshToken: account.mailbox.refreshToken,
        imapHost: account.mailbox.imapHost,
        imapPort: account.mailbox.imapPort,
        line: account.mailbox.line,
      });
    }
    if (account.email && looksEmail(account.email)) {
      return this.mailbox.parseCredential(account.email);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // 取件：执行
  // -------------------------------------------------------------------------

  async fetchPickup(payload: {
    records?: Array<{ key?: string; email?: string; line?: string; fromCard?: string | null }>;
    maxMessages?: number;
    query?: string;
  }) {
    const settings = await this.settings.getAll();
    const incoming = (payload?.records || []).slice(0, MAX_PICKUP_RECORDS);
    const maxMessages = Math.min(
      50,
      Math.max(1, Number(payload?.maxMessages) || settings.pickupMaxMessages || 10),
    );

    const prepared: Array<{
      key: string;
      email: string;
      accountId: number | null;
      cardKey: string | null;
      credential: MailboxCredential | null;
    }> = [];

    for (const item of incoming) {
      const key = String(item?.key || item?.email || '').toLowerCase();
      const account = item?.fromCard
        ? ((await this.prisma.account.findUnique({
            where: { cardKey: normalizeCardKey(item.fromCard) },
            include: { mailbox: true },
          })) as AccountWithMailbox | null)
        : key
          ? ((await this.prisma.account.findFirst({
              where: { OR: [{ email: key }, { name: key }] },
              include: { mailbox: true },
            })) as AccountWithMailbox | null)
          : null;

      // 凭据优先级：显式传入的四段式凭据行 → 数据库里该账号的邮箱凭据 → 裸邮箱（仅供展示，取件会报缺凭据）
      // 注意：不能写成 `parseCredential(line, key) || credentialOf(account)`，
      // 因为 key 本身是邮箱时 parseCredential 会返回一个「只有邮箱、没有 clientId/refreshToken」的对象，
      // 它是 truthy，会导致永远不回退到数据库凭据。
      const providedLine = typeof item?.line === 'string' && item.line.includes('----') ? item.line : undefined;
      const lineCredential = providedLine ? this.mailbox.parseCredential(providedLine) : null;
      const accountCredential = account ? this.credentialOf(account) : null;
      const keyCredential = key ? this.mailbox.parseCredential(key) : null;
      const credential =
        (lineCredential && this.mailbox.isComplete(lineCredential) ? lineCredential : null) ||
        (accountCredential && this.mailbox.isComplete(accountCredential) ? accountCredential : null) ||
        lineCredential ||
        accountCredential ||
        keyCredential;

      this.logger.debug(
        `取件准备 key=${key} 命中账号=${account?.id ?? 'none'} email=${account?.email ?? 'null'} mailbox=${
          account?.mailbox ? `${account.mailbox.email}|cid=${Boolean(account.mailbox.clientId)}|rt=${Boolean(
            account.mailbox.refreshToken,
          )}` : 'null'
        } providedLine=${providedLine ? 'yes' : 'no'} 凭据完整=${this.mailbox.isComplete(credential)}`,
      );

      prepared.push({
        key: key || credential?.email || '',
        email: credential?.email || key,
        accountId: account?.id ?? null,
        cardKey: account?.cardKey ?? (item?.fromCard ? normalizeCardKey(item.fromCard) : null),
        credential,
      });
    }

    const results = await this.mailbox.pickupMany(
      prepared.map((item) => ({ key: item.key, credential: item.credential })),
      { maxMessages, query: payload?.query },
    );

    const enriched = results.map((result, index) => {
      const meta = prepared[index];
      return {
        ...result,
        key: meta?.key || result.key,
        accountId: meta?.accountId ?? null,
        cardKey: meta?.cardKey ?? null,
      };
    });

    // 命中的封禁/额度回写数据库
    for (const result of enriched) {
      if (!result.accountId || !result.ok) continue;
      try {
        await this.prisma.pickupLog.create({
          data: {
            accountId: result.accountId,
            email: result.email || result.key,
            ok: result.ok,
            banned: result.banned,
            credits: result.credits,
            code: result.latestCode,
            error: result.error,
          },
        });
        // 取件即定档：命中额度关键字 → 写回账号档位（0 = 仍未命中，保持原值）
        const tier = tierFromMailCredits(result.credits);
        await this.prisma.account.update({
          where: { id: result.accountId },
          data: {
            banStatus: result.banned ? 'banned' : 'normal',
            banReason: result.banned ? result.banReason : null,
            banKeywords: result.banned ? JSON.stringify(result.banKeywords) : null,
            banCheckedAt: new Date(),
            ...(tier > 0 ? { credits: tier } : {}),
          },
        });
      } catch (error) {
        this.logger.warn(`回写取件结果失败：${error instanceof Error ? error.message : error}`);
      }
    }

    return {
      results: enriched.map((result) => ({
        ...result,
        /** 本次取件换算出的档位（未命中为 null） */
        tier: result.ok && tierFromMailCredits(result.credits) > 0 ? tierFromMailCredits(result.credits) : null,
      })),
      summary: this.mailbox.summarize(enriched),
    };
  }

  /** 按 key 列表导出账号（四段式凭据行 / 仅邮箱） */
  async exportPickup(payload: { keys?: string[]; kind?: string }) {
    const keys = (payload?.keys || []).map((key) => String(key).trim().toLowerCase()).filter(Boolean);
    const kind = payload?.kind === 'email' ? 'email' : 'line';
    if (!keys.length) return { content: '', filename: `pickup-export-${kind}.txt` };

    const accounts = (await this.prisma.account.findMany({
      where: { OR: [{ email: { in: keys } }, { name: { in: keys } }] },
      include: { mailbox: true },
    })) as AccountWithMailbox[];

    const byEmail = new Map<string, AccountWithMailbox>();
    for (const account of accounts) {
      const email = (account.mailbox?.email || account.email || account.name || '').toLowerCase();
      if (email) byEmail.set(email, account);
    }

    const lines: string[] = [];
    for (const key of keys) {
      const account = byEmail.get(key);
      if (kind === 'email') {
        lines.push(key);
        continue;
      }
      const credential = account ? this.credentialOf(account) : this.mailbox.parseCredential(key);
      if (!credential) continue;
      lines.push(
        credential.line ||
          [
            credential.email,
            credential.password || '',
            credential.clientId || '',
            credential.refreshToken || '',
          ].join('----'),
      );
    }

    return {
      content: `${lines.join('\n')}\n`,
      filename: `pickup-export-${kind}.txt`,
    };
  }

  /** 按取件结果分类导出 */
  async exportPickupClassified(payload: { keys?: string[]; category?: string }) {
    const keys = (payload?.keys || []).map((key) => String(key).trim().toLowerCase()).filter(Boolean);
    const accounts = (await this.prisma.account.findMany({
      where: keys.length ? { OR: [{ email: { in: keys } }, { name: { in: keys } }] } : { OR: [{ email: { in: keys } }] },
      include: { mailbox: true },
    })) as AccountWithMailbox[];

    const lines = accounts
      .map((account) => this.credentialOf(account))
      .filter((credential): credential is MailboxCredential => Boolean(credential))
      .map(
        (credential) =>
          credential.line ||
          [
            credential.email,
            credential.password || '',
            credential.clientId || '',
            credential.refreshToken || '',
          ].join('----'),
      );

    return {
      content: `${lines.join('\n')}\n`,
      filename: `pickup-${payload?.category || 'all'}.txt`,
    };
  }
}

function tryJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
