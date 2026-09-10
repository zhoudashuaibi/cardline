import { Injectable, Logger } from '@nestjs/common';
import {
  firstNonEmpty,
  formatSender,
  looksClientId,
  looksEmail,
  looksRefreshToken,
  mapWithConcurrency,
  sanitizeHtml,
  toDate,
} from '../common/utils';
import { MailAnalyzerService } from './mail-analyzer.service';
import type {
  MailMessage,
  MailboxCredential,
  OpenAiTokenResult,
  PickupResult,
  PickupSummary,
} from './mailbox.types';

const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const MESSAGES_URL = 'https://outlook.office.com/api/v2.0/me/messages';
/**
 * 只请求 IMAP scope 时部分账号换到的 token 无权读 REST 邮件接口，必须带上 Mail.ReadWrite。
 */
const DIRECT_SCOPE =
  'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/Mail.ReadWrite offline_access';

const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const INVALID_CREDENTIAL_CODES = [
  'invalid_grant',
  'unauthorized_client',
  'invalid_client',
  'interaction_required',
];

export interface PickupOptions {
  maxMessages?: number;
  timeoutMs?: number;
  query?: string;
}

@Injectable()
export class MailboxService {
  private readonly logger = new Logger(MailboxService.name);

  constructor(private readonly analyzer: MailAnalyzerService) {}

  private get concurrency(): number {
    return Number(process.env.PICKUP_CONCURRENCY || 4);
  }

  private get defaultTimeout(): number {
    return Number(process.env.PICKUP_TIMEOUT_MS || 30000);
  }

  /**
   * 把各种形态的凭据行/对象解析成 MailboxCredential。
   * 支持 "邮箱----密码----clientid----refresh_token" 与对象形式。
   */
  parseCredential(
    input: string | Partial<MailboxCredential> | undefined,
    fallbackEmail?: string,
  ): MailboxCredential | null {
    if (!input) {
      return fallbackEmail && looksEmail(fallbackEmail)
        ? { email: fallbackEmail.toLowerCase(), provider: 'outlook', authType: 'oauth2' }
        : null;
    }

    if (typeof input === 'object') {
      const email = firstNonEmpty(input.email, fallbackEmail);
      if (!email || !looksEmail(email)) return null;
      const credential: MailboxCredential = {
        email: email.toLowerCase(),
        provider: input.provider || 'outlook',
        authType: input.authType || 'oauth2',
        password: input.password || undefined,
        clientId: input.clientId || undefined,
        refreshToken: input.refreshToken || undefined,
        imapHost: input.imapHost || 'outlook.office365.com',
        imapPort: input.imapPort || 993,
      };
      credential.line =
        input.line ||
        [credential.email, credential.password || '', credential.clientId || '', credential.refreshToken || ''].join(
          '----',
        );
      return credential;
    }

    const line = String(input).trim();
    if (!line) {
      return fallbackEmail && looksEmail(fallbackEmail)
        ? { email: fallbackEmail.toLowerCase(), provider: 'outlook', authType: 'oauth2' }
        : null;
    }

    if (line.includes('----')) {
      const parts = line.split('----').map((part) => part.trim());
      let refreshToken = parts.slice(3).join('----');
      // 真实的 refresh_token 不含 ----；5 段以上的 source_line 末段是取件密码
      if (parts.length > 4 && looksRefreshToken(parts[3])) refreshToken = parts[3];
      const email = (parts[0] || fallbackEmail || '').toLowerCase();
      if (!email || !looksEmail(email)) return null;
      const credential: MailboxCredential = {
        email,
        password: parts[1] || undefined,
        clientId: parts[2] || undefined,
        refreshToken: refreshToken || undefined,
        provider: 'outlook',
        authType: 'oauth2',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
      };
      credential.line = [email, credential.password || '', credential.clientId || '', credential.refreshToken || ''].join(
        '----',
      );
      return credential;
    }

    if (looksEmail(line)) {
      return { email: line.toLowerCase(), provider: 'outlook', authType: 'oauth2' };
    }

    return null;
  }

  isComplete(credential: MailboxCredential | null): boolean {
    return Boolean(
      credential &&
        credential.email &&
        credential.clientId &&
        credential.refreshToken &&
        looksClientId(credential.clientId) &&
        looksRefreshToken(credential.refreshToken),
    );
  }

  // -------------------------------------------------------------------------
  // 微软 OAuth2：refresh_token → access_token
  // -------------------------------------------------------------------------

  private async exchangeMsToken(
    credential: MailboxCredential,
    timeoutMs: number,
  ): Promise<{ ok: boolean; accessToken?: string; error?: string; invalidCredential: boolean }> {
    if (!credential.clientId || !credential.refreshToken) {
      return {
        ok: false,
        error: '凭据不完整，需要 邮箱----密码----clientid----refresh_token',
        invalidCredential: false,
      };
    }

    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: credential.clientId,
          refresh_token: credential.refreshToken,
          scope: DIRECT_SCOPE,
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return {
        ok: false,
        error: `微软 token 接口请求失败：${error instanceof Error ? error.message : String(error)}`,
        invalidCredential: false,
      };
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const code = String(json.error || `HTTP ${response.status}`);
      const description = String(json.error_description || '')
        .replace(/\s+/g, ' ')
        .slice(0, 160);
      return {
        ok: false,
        error: `换 token 失败（${code}）：${description || 'refresh_token 可能已失效'}`,
        invalidCredential: INVALID_CREDENTIAL_CODES.includes(code),
      };
    }

    const accessToken = String(json.access_token || '');
    if (!accessToken) {
      return { ok: false, error: '微软 token 接口未返回 access_token', invalidCredential: false };
    }
    return { ok: true, accessToken, invalidCredential: false };
  }

  // -------------------------------------------------------------------------
  // 取件
  // -------------------------------------------------------------------------

  private async fetchMessages(
    accessToken: string,
    maxMessages: number,
    timeoutMs: number,
    query: string,
  ): Promise<{ ok: boolean; messages?: MailMessage[]; error?: string }> {
    const params = new URLSearchParams({
      $top: String(Math.max(1, Math.min(maxMessages, 50))),
      $orderby: 'ReceivedDateTime desc',
      $select: 'Id,Subject,From,ReceivedDateTime,BodyPreview,Body,IsRead',
    });
    if (query) params.set('$search', `"${query.replace(/"/g, '')}"`);

    let response: Response;
    try {
      response = await fetch(`${MESSAGES_URL}?${params.toString()}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          prefer: 'outlook.body-content-type=html',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return {
        ok: false,
        error: `官方邮件接口请求失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const hint =
        response.status === 401
          ? '（access_token 无权读取邮件，refresh_token 可能已失效）'
          : '';
      return { ok: false, error: `官方邮件接口 HTTP ${response.status}${hint}：${text.slice(0, 160)}` };
    }

    const data = (await response.json().catch(() => ({}))) as { value?: unknown[] };
    const messages = (Array.isArray(data.value) ? data.value : []).map((raw, index) =>
      this.normalizeMessage(raw, index),
    );
    return { ok: true, messages };
  }

  private normalizeMessage(raw: unknown, index: number): MailMessage {
    const message = isObject(raw) ? (raw as Record<string, any>) : {};
    const bodyHtml = sanitizeHtml(message.Body?.Content ?? '');
    const base = {
      id: String(message.Id || message.InternetMessageId || `message-${index}`),
      subject: String(message.Subject ?? ''),
      from: formatSender(message.From),
      receivedDateTime: toDate(message.ReceivedDateTime)?.toISOString() || new Date().toISOString(),
      isRead: message.IsRead !== false,
      bodyPreview: String(message.BodyPreview ?? ''),
      bodyHtml,
    };
    const analysis = this.analyzer.analyzeMessage(base);
    return {
      ...base,
      code: analysis.code,
      credits: analysis.credits,
      balance: analysis.balance,
      kind: analysis.kind,
    };
  }

  /** 单账号取件 */
  async pickupOne(
    credential: MailboxCredential | null,
    options: PickupOptions = {},
  ): Promise<PickupResult> {
    const email = credential?.email || '';
    const fetchedAt = new Date().toISOString();
    const timeoutMs = options.timeoutMs || this.defaultTimeout;
    const maxMessages = options.maxMessages || Number(process.env.PICKUP_MAX_MESSAGES || 10);
    const query = (options.query || '').trim();

    const failResult = (error: string): PickupResult => ({
      key: email,
      email,
      ok: false,
      error,
      banned: false,
      banReason: null,
      banKeywords: [],
      credits: null,
      creditsBalance: null,
      latestCode: null,
      fetchedAt,
      messages: [],
    });

    if (!credential || !looksEmail(credential.email)) {
      return failResult('邮箱地址无效');
    }
    if (!credential.clientId || !credential.refreshToken) {
      return failResult('凭据不完整，需要 邮箱----密码----clientid----refresh_token');
    }

    const token = await this.exchangeMsToken(credential, timeoutMs);
    if (!token.ok) return failResult(token.error || '换 token 失败');

    const fetched = await this.fetchMessages(token.accessToken!, maxMessages, timeoutMs, query);
    if (!fetched.ok) return failResult(fetched.error || '邮件接口返回异常');
    const messages = fetched.messages || [];
    const ban = this.analyzer.detectBanned(messages);
    const creditsHit = messages
      .map((message) => this.analyzer.extractCredits(message))
      .find((item) => Boolean(item));
    const latestCode = messages.map((message) => message.code).find((code) => Boolean(code)) || null;

    return {
      key: email,
      email,
      ok: true,
      error: null,
      banned: ban.banned,
      banReason: ban.banned ? `邮件命中封禁关键词：${ban.keywords.join('、')}` : null,
      banKeywords: ban.keywords,
      credits: creditsHit?.credits ?? null,
      creditsBalance: creditsHit?.balance ?? null,
      latestCode,
      fetchedAt,
      messages,
    };
  }

  /** 批量取件（带并发控制） */
  async pickupMany(
    items: Array<{ key: string; credential: MailboxCredential | null }>,
    options: PickupOptions = {},
  ): Promise<PickupResult[]> {
    const results = await mapWithConcurrency(items, this.concurrency, async (item) => {
      const result = await this.pickupOne(item.credential, options);
      return { ...result, key: item.key || result.email };
    });
    return results;
  }

  summarize(results: PickupResult[]): PickupSummary {
    return {
      total: results.length,
      success: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      banned: results.filter((item) => item.ok && item.banned).length,
      withCredits: results.filter((item) => item.ok && item.credits !== null).length,
    };
  }

  // -------------------------------------------------------------------------
  // OpenAI：用 refresh_token 换取新的 access_token（用于「兑换状态」判定）
  // -------------------------------------------------------------------------

  async refreshOpenAiToken(
    refreshToken: string | undefined,
    clientId = OPENAI_CLIENT_ID,
    timeoutMs = 20000,
  ): Promise<OpenAiTokenResult> {
    if (!refreshToken) {
      return { ok: false, error: '缺少 refresh_token', invalidCredential: false };
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'openid profile email offline_access',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return {
        ok: false,
        error: `OpenAI token 接口请求失败：${error instanceof Error ? error.message : String(error)}`,
        invalidCredential: false,
      };
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const code = String(json.error || `HTTP ${response.status}`);
      const description = String(json.error_description || '')
        .replace(/\s+/g, ' ')
        .slice(0, 160);
      return {
        ok: false,
        error: `刷新失败（${code}）：${description || 'refresh_token 可能已失效'}`,
        invalidCredential:
          INVALID_CREDENTIAL_CODES.includes(code) || response.status === 400 || response.status === 401,
      };
    }

    const accessToken = String(json.access_token || '');
    if (!accessToken) {
      return { ok: false, error: 'OpenAI token 接口未返回 access_token', invalidCredential: false };
    }
    const expiresIn = Number(json.expires_in);
    return {
      ok: true,
      accessToken,
      refreshToken: String(json.refresh_token || '') || undefined,
      idToken: String(json.id_token || '') || undefined,
      expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000) : undefined,
      invalidCredential: false,
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
