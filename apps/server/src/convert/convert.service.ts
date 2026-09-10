import { Injectable, Logger } from '@nestjs/common';
import {
  emailKey,
  firstNonEmpty,
  get,
  isPlainObject,
  isoFromUnixSeconds,
  looksClientId,
  looksEmail,
  looksPassword,
  looksRefreshToken,
  toDate,
} from '../common/utils';
import type {
  ConvertIssue,
  ConvertResult,
  ConvertedItem,
  CpaAccount,
  CpaBatchDocument,
  MailboxCredential,
  NormalizedAccount,
  Sub2ApiAccount,
  Sub2ApiDocument,
} from './convert.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX_PATH_PATTERN = /mailbox|bind|primary/i;
const OPENAI_PATH_PATTERN = /credentials|openai|chatgpt|\bgpt\b/i;

/** sub2api 账号原样透传的附加字段（`extra` 里带 2FA / 隐私模式 / 长上下文等标记） */
export interface Sub2ApiPassthrough {
  extra?: Record<string, unknown>;
  concurrency?: number;
  priority?: number;
  rateMultiplier?: number;
  autoPauseOnExpired?: boolean;
  groupIds?: number[];
}

/**
 * 从原始账号对象里读出 sub2api 侧的透传字段。
 *
 * 导入时这些字段存在 `rawJson` 里，交付/导出时账号是从数据库重建的，
 * 必须用同一个函数还原，否则 `extra`（含 `two_factor_*`）会被静默丢掉。
 */
export function readSub2ApiPassthrough(
  record: Record<string, unknown> | undefined,
): Sub2ApiPassthrough {
  if (!record) return {};
  const numeric = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  };
  const integer = (value: unknown): number | undefined => {
    const num = numeric(value);
    return num === undefined ? undefined : Math.trunc(num);
  };
  return {
    extra: isPlainObject(record.extra) ? (record.extra as Record<string, unknown>) : undefined,
    concurrency: integer(record.concurrency),
    priority: integer(record.priority),
    rateMultiplier: numeric(record.rate_multiplier),
    autoPauseOnExpired:
      typeof record.auto_pause_on_expired === 'boolean' ? record.auto_pause_on_expired : undefined,
    groupIds: Array.isArray(record.group_ids)
      ? (record.group_ids.filter((item) => Number.isFinite(Number(item))) as number[])
      : undefined,
  };
}

/** 判断对象是否是一个「账号对象」 */
function looksLikeAccountRecord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const accessToken = firstNonEmpty(
    value.access_token,
    value.accessToken,
    get(value, 'credentials.access_token'),
    get(value, 'credentials.accessToken'),
    get(value, 'tokens.access_token'),
    get(value, 'tokens.accessToken'),
  );
  if (!accessToken) return false;
  return Boolean(
    value.platform ||
      value.type ||
      value.email ||
      value.name ||
      value.credentials ||
      value.tokens ||
      value.refresh_token ||
      value.refreshToken,
  );
}

/**
 * 账号对象收集器：与参考实现 collectSessionLikeObjects 行为一致 —— 命中即止，不再深入子节点。
 */
export function collectAccountObjects(
  value: unknown,
  sourceName = 'input',
): Array<{ value: Record<string, unknown>; sourceName: string; path: string }> {
  const found: Array<{ value: Record<string, unknown>; sourceName: string; path: string }> = [];
  const visited = new WeakSet<object>();

  const visit = (item: unknown, path: string): void => {
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(item)) return;
    if (visited.has(item)) return;
    visited.add(item);

    if (looksLikeAccountRecord(item)) {
      found.push({ value: item, sourceName, path });
      return;
    }

    for (const [key, child] of Object.entries(item)) {
      if (key === 'proxies' || key === 'x_revive_manifest') continue;
      visit(child, `${path}.${key}`);
    }
  };

  visit(value, '$');
  return found;
}

@Injectable()
export class ConvertService {
  private readonly logger = new Logger(ConvertService.name);

  // -------------------------------------------------------------------------
  // 基础工具
  // -------------------------------------------------------------------------

  private decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  private encodeBase64UrlJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  parseJwtPayload(token: unknown): Record<string, unknown> | undefined {
    if (typeof token !== 'string' || token.trim() === '') return undefined;
    const segments = token.split('.');
    if (segments.length < 2) return undefined;
    try {
      const parsed = JSON.parse(this.decodeBase64Url(segments[1]));
      return isPlainObject(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private openAiAuthSection(payload: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!payload) return {};
    const auth = payload['https://api.openai.com/auth'];
    return isPlainObject(auth) ? auth : {};
  }

  private openAiProfileSection(
    payload: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!payload) return {};
    const profile = payload['https://api.openai.com/profile'];
    return isPlainObject(profile) ? profile : {};
  }

  /** 构造 Codex 可解析的占位 id_token（与参考实现一致） */
  buildSyntheticIdToken(
    email?: string,
    accountId?: string,
    planType?: string,
    userId?: string,
    expiresAt?: string,
  ): string | undefined {
    if (!accountId) return undefined;
    const now = Math.trunc(Date.now() / 1000);
    const authInfo: Record<string, unknown> = { chatgpt_account_id: accountId };
    const expires = expiresAt ? Math.trunc(new Date(expiresAt).getTime() / 1000) : 0;
    const exp = Number.isFinite(expires) && expires > 0 ? expires : now + 90 * 24 * 60 * 60;
    if (planType) authInfo.chatgpt_plan_type = planType;
    if (userId) {
      authInfo.chatgpt_user_id = userId;
      authInfo.user_id = userId;
    }
    const payload: Record<string, unknown> = {
      iat: now,
      exp,
      'https://api.openai.com/auth': authInfo,
    };
    if (email) payload.email = email;
    return `${this.encodeBase64UrlJson({ alg: 'none', typ: 'JWT', cpa_synthetic: true })}.${this.encodeBase64UrlJson(payload)}.synthetic`;
  }

  /**
   * 去掉空值。
   *
   * `keepEmpty` 为 true 时保留空字符串 —— 只用于 `extra` 这类原样透传区，
   * 目的是让交付文件与导入时的原文件逐字段一致（例如 `two_factor_error: ""`）。
   */
  private stripUnavailable(value: unknown, keepEmpty = false): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stripUnavailable(item, keepEmpty)).filter((item) => item !== undefined);
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value)
        .map(([key, item]) => [key, this.stripUnavailable(item, keepEmpty)] as const)
        .filter(([, item]) => item !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }
    if (value === undefined || value === null) return undefined;
    if (value === '' && !keepEmpty) return undefined;
    return value;
  }

  // -------------------------------------------------------------------------
  // 邮箱取件凭据提取
  // -------------------------------------------------------------------------

  /** 扫描对象树，按路径权重挑选最佳邮箱凭据 */
  extractMailbox(account: Record<string, unknown>, fallbackEmail?: string): MailboxCredential | undefined {
    const found: {
      email: Array<{ score: number; value: string }>;
      password: Array<{ score: number; value: string }>;
      clientId: Array<{ score: number; value: string }>;
      refreshToken: Array<{ score: number; value: string }>;
      line: Array<{ score: number; value: string }>;
    } = { email: [], password: [], clientId: [], refreshToken: [], line: [] };

    const scoreCandidate = (key: string, value: string, path: string): void => {
      const text = value.trim();
      if (!text || text.length > 8192) return;
      const keyLower = key.toLowerCase().replace(/[\s-]+/g, '_');
      const mailboxBonus = MAILBOX_PATH_PATTERN.test(path) ? 40 : 0;
      const openaiPenalty = OPENAI_PATH_PATTERN.test(path) ? -40 : 0;

      if (/^(source_?line|line)$/.test(keyLower) && text.includes('----')) {
        const parts = text.split('----').map((part) => part.trim());
        let token = parts.slice(3).join('----');
        if (parts.length > 4 && looksRefreshToken(parts[3])) token = parts[3];
        if (
          parts.length >= 4 &&
          looksEmail(parts[0]) &&
          parts[1] &&
          looksClientId(parts[2]) &&
          looksRefreshToken(token)
        ) {
          found.line.push({
            score: 200 + mailboxBonus,
            value: [parts[0].toLowerCase(), parts[1], parts[2], token].join('----'),
          });
        }
        return;
      }

      if (looksEmail(text)) {
        let score = 15;
        if (/^(bind_?email|primary_?email)$/.test(keyLower)) score = 35;
        else if (/^mailbox/.test(keyLower)) score = 30;
        else if (keyLower === 'email') score = 25;
        found.email.push({ score: score + mailboxBonus + openaiPenalty, value: text });
        return;
      }

      if (/^(name|label|title)/.test(keyLower) && text.includes('----') && looksEmail(text.split('----')[0])) {
        found.email.push({ score: 5, value: text.split('----')[0].trim() });
        return;
      }

      if (/^(client_?id|clientid)$/.test(keyLower) && looksClientId(text)) {
        found.clientId.push({
          score: (UUID_PATTERN.test(text) ? 25 : 8) + mailboxBonus + openaiPenalty,
          value: text,
        });
        return;
      }

      if (/^(refresh_?token|refreshtoken)$/.test(keyLower) && looksRefreshToken(text)) {
        found.refreshToken.push({
          score: (text.length >= 100 ? 25 : 5) + mailboxBonus + openaiPenalty,
          value: text,
        });
        return;
      }

      if (/(^|_)password$/.test(keyLower) && looksPassword(text)) {
        let score = 12;
        if (/^(mailbox|mail)_?password$/.test(keyLower)) score = 30;
        else if (keyLower === 'password') score = 25;
        else if (keyLower === 'pickup_password') score = 20;
        found.password.push({ score: score + mailboxBonus + openaiPenalty, value: text });
      }
    };

    const collect = (node: unknown, path: string, seen: WeakSet<object>): void => {
      if (Array.isArray(node)) {
        node.forEach((child, index) => collect(child, `${path}[${index}]`, seen));
        return;
      }
      if (!isPlainObject(node)) return;
      if (seen.has(node)) return;
      seen.add(node);

      for (const [key, value] of Object.entries(node)) {
        const childPath = `${path}.${key}`;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const expanded = JSON.parse(trimmed);
              collect(expanded, childPath, seen);
              continue;
            } catch {
              /* 不是 JSON，按普通值打分 */
            }
          }
          scoreCandidate(key, value, childPath);
        } else if (isPlainObject(value) || Array.isArray(value)) {
          collect(value, childPath, seen);
        }
      }
    };

    collect(account, '$', new WeakSet<object>());

    const best = (list: Array<{ score: number; value: string }>): string | undefined =>
      list.reduce<{ score: number; value: string } | undefined>(
        (top, item) => (!top || item.score > top.score ? item : top),
        undefined,
      )?.value;

    const lineHit = best(found.line);
    if (lineHit) {
      const parts = lineHit.split('----');
      return {
        email: parts[0].toLowerCase(),
        password: parts[1] || undefined,
        clientId: parts[2] || undefined,
        refreshToken: parts.slice(3).join('----') || undefined,
        provider: 'outlook',
        authType: 'oauth2',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        line: lineHit,
      };
    }

    const emailHit = best(found.email) || (fallbackEmail && looksEmail(fallbackEmail) ? fallbackEmail : undefined);
    const password = best(found.password);
    const clientId = best(found.clientId);
    const refreshToken = best(found.refreshToken);

    if (!emailHit && !refreshToken && !clientId) return undefined;
    if (!emailHit) return undefined;

    const provider =
      firstNonEmpty(get(account, 'extra.mailbox_provider'), get(account, 'notes.mailbox.provider')) ||
      'outlook';

    const credential: MailboxCredential = {
      email: emailHit.toLowerCase(),
      password,
      clientId,
      refreshToken,
      provider,
      authType: 'oauth2',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
    };
    if (password || clientId || refreshToken) {
      credential.line = [credential.email, password || '', clientId || '', refreshToken || ''].join('----');
    }
    return credential;
  }

  // -------------------------------------------------------------------------
  // 归一化
  // -------------------------------------------------------------------------

  normalizeAccount(
    record: Record<string, unknown>,
    options: { now?: Date; source?: string } = {},
  ): NormalizedAccount {
    const accessToken =
      firstNonEmpty(
        record.access_token,
        record.accessToken,
        get(record, 'credentials.access_token'),
        get(record, 'credentials.accessToken'),
        get(record, 'tokens.access_token'),
        get(record, 'tokens.accessToken'),
        get(record, 'token.access_token'),
        get(record, 'token.accessToken'),
      ) || '';
    if (!accessToken) throw new Error('缺少 access_token');

    const refreshToken = firstNonEmpty(
      record.refresh_token,
      record.refreshToken,
      get(record, 'credentials.refresh_token'),
      get(record, 'credentials.refreshToken'),
      get(record, 'tokens.refresh_token'),
      get(record, 'tokens.refreshToken'),
      get(record, 'token.refresh_token'),
      get(record, 'token.refreshToken'),
    );
    const idToken = firstNonEmpty(
      record.id_token,
      record.idToken,
      get(record, 'credentials.id_token'),
      get(record, 'credentials.idToken'),
      get(record, 'tokens.id_token'),
      get(record, 'tokens.idToken'),
      get(record, 'token.id_token'),
      get(record, 'token.idToken'),
    );
    const sessionToken = firstNonEmpty(
      record.session_token,
      record.sessionToken,
      get(record, 'credentials.session_token'),
      get(record, 'tokens.session_token'),
      get(record, 'token.session_token'),
    );

    const payload = this.parseJwtPayload(accessToken);
    const idPayload = this.parseJwtPayload(idToken);
    const auth = this.openAiAuthSection(payload);
    const idAuth = this.openAiAuthSection(idPayload);
    const profile = this.openAiProfileSection(payload);

    const email =
      firstNonEmpty(
        get(record, 'credentials.email'),
        get(record, 'extra.email'),
        get(record, 'extra.mailbox_email'),
        get(record, 'extra.mailbox_user_email'),
        record.email,
        get(record, 'user.email'),
        get(record, 'meta.label'),
        record.label,
        profile.email,
        idPayload?.email,
        payload?.email,
        typeof record.name === 'string' && record.name.includes('----')
          ? record.name.split('----')[0]
          : record.name,
      ) || undefined;

    const accountId = firstNonEmpty(
      get(record, 'credentials.chatgpt_account_id'),
      record.chatgpt_account_id,
      record.chatgptAccountId,
      record.account_id,
      get(record, 'account.id'),
      get(record, 'tokens.account_id'),
      get(record, 'meta.chatgpt_account_id'),
      auth.chatgpt_account_id,
      idAuth.chatgpt_account_id,
      get(record, 'extra.workspace_id'),
    );

    const userId = firstNonEmpty(
      get(record, 'credentials.chatgpt_user_id'),
      record.chatgpt_user_id,
      record.chatgptUserId,
      get(record, 'user.id'),
      get(record, 'account.user_id'),
      auth.chatgpt_user_id,
      auth.user_id,
      idAuth.chatgpt_user_id,
      idAuth.user_id,
    );

    const planType = firstNonEmpty(
      get(record, 'credentials.plan_type'),
      record.plan_type,
      record.planType,
      get(record, 'account.plan_type'),
      get(record, 'account.planType'),
      record.chatgpt_plan_type,
      auth.chatgpt_plan_type,
      idAuth.chatgpt_plan_type,
    );

    const expiresAtRaw =
      toDate(get(record, 'credentials.expires_at')) ||
      toDate(record.expires_at) ||
      toDate(record.expired) ||
      toDate(record.expiresAt) ||
      toDate(record.expires) ||
      (payload?.exp ? toDate(payload.exp) : undefined);

    const accessTokenExpiresAt = Number.isFinite(Number(payload?.exp))
      ? Math.trunc(Number(payload?.exp))
      : expiresAtRaw
        ? Math.trunc(expiresAtRaw.getTime() / 1000)
        : undefined;

    const name =
      firstNonEmpty(
        email,
        typeof record.name === 'string' && record.name.includes('----')
          ? record.name.split('----')[0]
          : undefined,
        record.name,
        get(record, 'extra.mailbox_lookup_name'),
        options.source,
        'ChatGPT Account',
      ) || 'ChatGPT Account';

    const mailbox = this.extractMailbox(record, email);

    const rawSource: 'sub2api' | 'cpa' =
      isPlainObject(record.credentials) || record.platform === 'openai' ? 'sub2api' : 'cpa';

    return {
      name,
      email,
      planType,
      accountId,
      userId,
      accessToken,
      refreshToken,
      idToken,
      sessionToken,
      expiresAt:
        firstNonEmpty(expiresAtRaw ? expiresAtRaw.toISOString() : undefined, undefined) || undefined,
      accessTokenExpiresAt,
      rawSource,
      raw: record,
      mailbox,
      ...readSub2ApiPassthrough(record),
    };
  }

  // -------------------------------------------------------------------------
  // 输出：CPA
  // -------------------------------------------------------------------------

  toCpaAccount(account: NormalizedAccount, now = new Date()): CpaAccount {
    const synthetic = account.idToken
      ? undefined
      : this.buildSyntheticIdToken(
          account.email,
          account.accountId,
          account.planType,
          account.userId,
          account.expiresAt,
        );
    const idToken = account.idToken || synthetic;

    const cpa = Object.fromEntries(
      Object.entries({
        type: 'codex',
        account_id: account.accountId,
        chatgpt_account_id: account.accountId,
        email: account.email,
        name: account.name,
        plan_type: account.planType,
        chatgpt_plan_type: account.planType,
        id_token: idToken,
        id_token_synthetic: synthetic ? true : undefined,
        access_token: account.accessToken,
        refresh_token: account.refreshToken || '',
        session_token: account.sessionToken,
        last_refresh: now.toISOString(),
        expired: account.expiresAt,
        disabled: account.raw && account.raw.disabled === true ? true : undefined,
      }).filter(([, value]) => value !== undefined && value !== null),
    ) as unknown as CpaAccount;

    // 参考 cpa_格式参考.json：账号对象带 extra。原样透传导入字段（含 two_factor_* 2FA 标记），
    // 空串保留；Codex CLI 只读它认识的键，未知键会被忽略。
    const extra = this.buildCpaExtra(account);
    if (extra) cpa.extra = extra;

    return cpa;
  }

  /**
   * CPA 的 `extra`：把账号导入时的附加字段**一个键不加、一个键不减**地原样带出。
   *
   * 与 sub2api 的 `extra` 的区别是这里**不注入** `email_key` / `name` / `mailbox_*` 等服务端
   * 补充键 —— 来源 `extra` 里本来就有 `mailbox_*` 的话会照原样带出，但服务端不会额外补。
   */
  private buildCpaExtra(account: NormalizedAccount): Record<string, unknown> | undefined {
    if (!account.extra) return undefined;
    const entries = Object.entries(account.extra).filter(
      ([, value]) => value !== undefined && value !== null,
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  // -------------------------------------------------------------------------
  // 输出：sub2api
  // -------------------------------------------------------------------------

  toSub2ApiAccount(account: NormalizedAccount, now = new Date()): Sub2ApiAccount {
    const notesPayload = this.buildMailboxNotes(account, now);
    const sub2api = this.stripUnavailable({
      name: account.name,
      platform: 'openai',
      type: 'oauth',
      expires_at: account.accessTokenExpiresAt,
      auto_pause_on_expired:
        account.autoPauseOnExpired ?? (account.accessTokenExpiresAt ? true : undefined),
      concurrency: account.concurrency ?? 10,
      priority: account.priority ?? 1,
      ...(account.rateMultiplier !== undefined ? { rate_multiplier: account.rateMultiplier } : {}),
      ...(account.groupIds && account.groupIds.length ? { group_ids: account.groupIds } : {}),
      ...(notesPayload ? { notes: notesPayload } : {}),
      credentials: {
        access_token: account.accessToken,
        chatgpt_account_id: account.accountId,
        chatgpt_user_id: account.userId,
        client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        email: account.email,
        expires_at: account.expiresAt
          ? Math.trunc(new Date(account.expiresAt).getTime() / 1000)
          : undefined,
        id_token: account.idToken,
        plan_type: account.planType,
        refresh_token: account.refreshToken,
      },
    }) as Sub2ApiAccount;

    if (sub2api.credentials) {
      sub2api.credentials = this.stripUnavailable(sub2api.credentials) as Record<string, unknown>;
    }
    // extra 是透传区（含 two_factor_* 等），不参与整体去空值，否则 "" 会被抹掉
    const extra = this.buildExtra(account);
    if (extra) sub2api.extra = extra;

    return sub2api;
  }

  /**
   * 组装 `extra`：导入时的原字段**原样保留**（含空串，如 `two_factor_error: ""`），
   * 服务端补充的字段只在有值时写入。
   */
  private buildExtra(account: NormalizedAccount): Record<string, unknown> | undefined {
    const added = (this.stripUnavailable({
      email: account.email,
      email_key: emailKey(account.email),
      name: account.name,
      mailbox_email: account.mailbox?.email,
      mailbox_provider: account.mailbox?.provider,
      mailbox_auth_type: account.mailbox?.authType,
      mailbox_lookup_name: account.mailbox?.line,
      source: firstNonEmpty(get(account.raw, 'extra.source'), 'cardline'),
    }) || {}) as Record<string, unknown>;

    const merged = { ...(account.extra || {}), ...added };
    const entries = Object.entries(merged).filter(([, value]) => value !== undefined && value !== null);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  /** notes 里保存 mailbox + gpt 段，便于后续往返转换 */
  private buildMailboxNotes(account: NormalizedAccount, now: Date): string | undefined {
    const original = firstNonEmpty(get(account.raw, 'notes'));
    if (original) {
      try {
        const parsed = JSON.parse(original);
        if (isPlainObject(parsed) && parsed.mailbox) return original;
      } catch {
        /* 忽略无法解析的 notes */
      }
    }
    const mailbox = account.mailbox;
    if (!mailbox) return undefined;
    const payload = {
      mailbox: {
        bind_email: mailbox.email,
        primary_email: mailbox.email,
        password: mailbox.password,
        client_id: mailbox.clientId,
        refresh_token: mailbox.refreshToken,
        pickup_password: mailbox.password,
        provider: mailbox.provider || 'outlook',
        auth_type: mailbox.authType || 'oauth2',
        imap_host: mailbox.imapHost || 'outlook.office365.com',
        imap_port: String(mailbox.imapPort || 993),
        source_line:
          mailbox.line ||
          [mailbox.email, mailbox.password || '', mailbox.clientId || '', mailbox.refreshToken || ''].join(
            '----',
          ),
      },
      imported_at: now.toISOString(),
      imported_by: 'cardline',
    };
    return JSON.stringify(payload, null, 2);
  }

  toSub2ApiDocument(accounts: NormalizedAccount[], now = new Date()): Sub2ApiDocument {
    return {
      type: 'sub2api-data',
      version: 1,
      exported_at: now.toISOString(),
      proxies: [],
      accounts: accounts.map((account) => this.toSub2ApiAccount(account, now)),
    };
  }

  /** CPA 文档：单账号输出对象，多账号输出数组（与参考实现一致） */
  toCpaDocument(accounts: NormalizedAccount[], now = new Date()): CpaAccount | CpaAccount[] {
    const list = accounts.map((account) => this.toCpaAccount(account, now));
    return list.length === 1 ? list[0] : list;
  }

  /** CPA 批量文档：始终使用 accounts 包装结构，对齐 cpa_格式参考.json */
  toCpaBatchDocument(accounts: NormalizedAccount[], now = new Date()): CpaBatchDocument {
    return {
      accounts: accounts.map((account) => this.toCpaAccount(account, now)),
      exported_at: now.toISOString(),
      proxies: [],
    };
  }

  /** 邮箱 TXT：每行四段式凭据 */
  toEmailLines(accounts: NormalizedAccount[]): string[] {
    return accounts
      .map((account) => {
        const mailbox = account.mailbox;
        const line =
          mailbox?.line ||
          (mailbox?.email
            ? [mailbox.email, mailbox.password || '', mailbox.clientId || '', mailbox.refreshToken || ''].join(
                '----',
              )
            : '');
        if (!line.endsWith('----') && line.split('----').length >= 4 && looksEmail(line.split('----')[0])) {
          return line;
        }
        // 凭据不全时退化为「邮箱----密码----clientid----refresh_token」的空位形式
        if (mailbox?.email) {
          return [
            mailbox.email,
            mailbox.password || '',
            mailbox.clientId || '',
            mailbox.refreshToken || '',
          ].join('----');
        }
        return '';
      })
      .filter((line) => Boolean(line) && looksEmail(line.split('----')[0]));
  }

  // -------------------------------------------------------------------------
  // 解析输入
  // -------------------------------------------------------------------------

  /** 逐行 / JSONL / 整包 JSON 通用解析 */
  parseAccounts(content: string, sourceName = 'input'): ConvertResult {
    const text = String(content ?? '').trim();
    const items: ConvertedItem[] = [];
    const issues: ConvertIssue[] = [];
    if (!text) return { items, issues };

    const records: Array<{ value: Record<string, unknown>; sourceName: string; path: string }> = [];

    const pushDocument = (parsed: unknown, name: string): void => {
      // sub2api 整包：{ accounts: [...] }
      const collected = collectAccountObjects(parsed, name);
      if (collected.length) {
        records.push(...collected);
        return;
      }
      // 兜底：整体扫描
      if (isPlainObject(parsed)) {
        const fallback = this.harvestFallback(parsed, name);
        if (fallback) records.push(fallback);
      }
    };

    const whole = this.tryParseJson(text);
    if (whole.ok) {
      pushDocument(whole.value, sourceName);
    } else {
      for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
        const line = rawLine.trim();
        if (!line) continue;
        const parsedLine = this.tryParseJson(line);
        if (parsedLine.ok) {
          pushDocument(parsedLine.value, `${sourceName}#L${lineIndex + 1}`);
          continue;
        }
        // 卡密导出 TXT：忽略包装行，只挑出 JSON 片段
        const embedded = this.extractEmbeddedJson(line);
        if (embedded) {
          for (const fragment of embedded) {
            const parsedFragment = this.tryParseJson(fragment);
            if (parsedFragment.ok) pushDocument(parsedFragment.value, `${sourceName}#L${lineIndex + 1}`);
          }
        }
      }
      if (!records.length) {
        // 整个文本里可能存在跨行 JSON 片段
        const embedded = this.extractEmbeddedJson(text);
        for (const fragment of embedded) {
          const parsedFragment = this.tryParseJson(fragment);
          if (parsedFragment.ok) pushDocument(parsedFragment.value, sourceName);
        }
      }
    }

    records.forEach((record, index) => {
      try {
        const account = this.normalizeAccount(record.value, {
          source: record.sourceName,
        });
        items.push(this.decorate(account, index, record.sourceName, record.path));
      } catch (error) {
        issues.push({
          index,
          source: record.sourceName,
          path: record.path,
          reason: error instanceof Error ? error.message : '无法转换',
        });
      }
    });

    if (!records.length) {
      issues.push({
        index: 0,
        source: sourceName,
        path: '$',
        reason: '未找到包含 access_token 的账号对象',
      });
    }

    return { items, issues };
  }

  private decorate(
    account: NormalizedAccount,
    index: number,
    source: string,
    path: string,
  ): ConvertedItem {
    const now = new Date();
    const cpa = this.toCpaAccount(account, now);
    const sub2api = this.toSub2ApiAccount(account, now);
    const line = this.toEmailLines([account])[0];
    return { index, source, sourcePath: path, account, cpa, sub2api, emailLine: line };
  }

  private tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false };
    }
  }

  /** 从文本中提取 { ... } 片段（卡密导出 TXT 场景） */
  private extractEmbeddedJson(text: string): string[] {
    const fragments: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') {
        if (depth === 0) start = index;
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          fragments.push(text.slice(start, index + 1));
          start = -1;
        }
        if (depth < 0) depth = 0;
      }
    }
    return fragments;
  }

  /** 整包扫描兜底：把根对象当成一个账号尝试 */
  private harvestFallback(
    root: Record<string, unknown>,
    sourceName: string,
  ): { value: Record<string, unknown>; sourceName: string; path: string } | undefined {
    const candidate = looksLikeAccountRecord(root) ? root : undefined;
    return candidate ? { value: candidate, sourceName, path: '$' } : undefined;
  }

  /** 给交付文件挑选合适的文档字符串 */
  buildDeliverContent(format: string, accounts: NormalizedAccount[], now = new Date()): string {
    if (format === 'email') {
      return `${this.toEmailLines(accounts).join('\n')}\n`;
    }
    if (format === 'cpa') {
      return `${JSON.stringify(this.toCpaDocument(accounts, now), null, 2)}\n`;
    }
    return `${JSON.stringify(this.toSub2ApiDocument(accounts, now), null, 2)}\n`;
  }

  /**
   * 批量交付内容：把多张卡密的账号合并成**一份**完整文档（而不是多份文档首尾相接）。
   *
   * - `sub2api`：`{ type, version, exported_at, proxies, accounts[] }`（同单卡结构，账号累积）
   * - `cpa`：`{ accounts[], exported_at, proxies[] }` 包装结构，对齐 `cpa_格式参考.json`
   * - `email`：所有凭据行直接拼接，不带任何分隔标题
   */
  buildMergedContent(format: string, accounts: NormalizedAccount[], now = new Date()): string {
    if (format === 'email') {
      return this.buildDeliverContent('email', accounts, now);
    }
    if (format === 'cpa') {
      return `${JSON.stringify(this.toCpaBatchDocument(accounts, now), null, 2)}\n`;
    }
    return this.buildDeliverContent('sub2api', accounts, now);
  }
}
