import { Injectable, Logger } from '@nestjs/common';
import { firstNonEmpty, htmlToText, isPlainObject, toDate } from '../common/utils';

/** 验证码语境关键词 */
const CODE_CONTEXT_PATTERN =
  /(?:openai|chatgpt|verification|verify|security\s*code|one[-\s]?time|\botp\b|验证码|校验码|一次性|認証コード|確認コード|verificación|código)/i;

/** 额度命中关键词（多语言） */
const BALANCE_KEYWORDS: RegExp[] = [
  /we[\s'’]*ve\s+added\s+([\d,]+(?:\.\d+)?)\s+credits\b/i,
  /added\s+([\d,]+(?:\.\d+)?)\s+credits\b/i,
  /添加(?:了|成功)?\s*([\d,]+(?:\.\d+)?)\s*(?:个)?\s*额度/,
  /(?:新增|加入|贈送|赠送)(?:了)?\s*([\d,]+(?:\.\d+)?)\s*(?:个)?\s*(?:額度|额度)/,
  /已贈\s*([\d,]+(?:\.\d+)?)\s*(?:个)?\s*(?:額度|额度)/,
  /([\d,]+(?:\.\d+)?)\s*(?:クレジット|クレジット)?(?:を)?\s*(?:追加|付与)/,
  /([\d,]+(?:\.\d+)?)\s*크레딧(?:이|을)?\s*(?:추가|지급)/,
  /(?:agreg|añad)\w*\s+([\d,]+(?:\.\d+)?)\s+créditos?\b/i,
  /([\d,]+(?:\.\d+)?)\s+créditos?\s+(?:a|en)\s+la\s+cuenta/i,
  /(?:cộng|thêm|tặng)\s+([\d,]+(?:\.\d+)?)\s+credits?\b/i,
  /([\d,]+(?:\.\d+)?)\s+credits?\s+(?:vào|cho)\s+(?:mỗi\s+)?tài\s*khoản/i,
];

/** 封禁关键词：命中即判定账号被封 */
const BANNED_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern:
      /account(?:[\s_-]+(?:has\s+been)?)?[\s_-]*(?:deactivat\w*|suspended|disabled|terminated)|(?:deactivated|suspended|disabled|terminated)[\s\S]{0,60}account/i,
    label: 'account deactivated',
  },
  {
    pattern: /your\s+account\s+(?:has\s+been\s+)?(?:deactivated|suspended|disabled|banned|closed)/i,
    label: 'your account has been suspended',
  },
  { pattern: /account\s+permanently\s+deleted/i, label: 'account permanently deleted' },
  { pattern: /(?:violat|breach)\w*[\s\S]{0,40}(?:usage\s+polic|terms\s+of\s+use)/i, label: 'usage policy violation' },
  { pattern: /(?:账户|帳戶|账号|帳號|您的帳號|您的账户)(?:已被|已经|已)?\s*(?:停用|禁用|封禁|封鎖|凍結|冻结|注销)/, label: '账户已停用' },
  { pattern: /(?:账号|帳號|账户|帳戶)\s*(?:被)?\s*(?:暂停|暫停|suspend)/i, label: '账号被暂停' },
  { pattern: /(?:アカウント)(?:が)?\s*(?:無効|停止|削除|凍結)/, label: 'アカウント無効' },
  { pattern: /(?:계정)(?:이|가)?\s*(?:정지|비활성화|삭제)/, label: '계정 정지' },
];

export interface AnalyzeResult {
  code: string | null;
  credits: number | null;
  balance: number | null;
  banned: boolean;
  banKeywords: string[];
  kind: 'code' | 'credits' | 'ban' | 'normal';
}

@Injectable()
export class MailAnalyzerService {
  private readonly logger = new Logger(MailAnalyzerService.name);

  /** 邮件全文（HTML 去标签后） */
  messageText(message: {
    subject?: string;
    bodyPreview?: string;
    bodyHtml?: string;
  }): string {
    const body = message.bodyHtml ? htmlToText(message.bodyHtml) : '';
    return [message.subject, message.bodyPreview, body]
      .map((value) => String(value ?? ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractCode(message: { subject?: string; bodyPreview?: string; bodyHtml?: string }): string | null {
    const source = this.messageText(message);
    if (!source) return null;

    const anchored = source.match(
      /(?:验证码|校验码|認証コード|確認コード|verification(?:\s+code)?|security\s*code|code|one[-\s]?time(?:\s+password)?|código)[^0-9]{0,45}\b(\d{4,8})\b/i,
    );
    if (anchored) return anchored[1];

    for (const match of source.matchAll(/(?:^|\s)(\d{6})(?=$|\s)/g)) {
      const context = source.slice(
        Math.max(0, (match.index ?? 0) - 60),
        (match.index ?? 0) + match[0].length + 60,
      );
      if (CODE_CONTEXT_PATTERN.test(context)) return match[1];
    }

    const all = source.match(/\b\d{6}\b/g);
    return all ? all[0] : null;
  }

  extractCredits(message: {
    subject?: string;
    bodyPreview?: string;
    bodyHtml?: string;
  }): { credits: number; balance: number } | null {
    const source = this.messageText(message);
    if (!source) return null;
    for (const pattern of BALANCE_KEYWORDS) {
      const match = source.match(pattern);
      if (match && match[1]) {
        const credits = Number(match[1].replace(/,/g, ''));
        if (Number.isFinite(credits) && credits > 0) {
          return { credits, balance: credits / 25 };
        }
      }
    }
    return null;
  }

  detectBanned(messages: Array<{ subject?: string; bodyPreview?: string; bodyHtml?: string }>): {
    banned: boolean;
    keywords: string[];
  } {
    const hits = new Set<string>();
    for (const message of messages) {
      const source = this.messageText(message);
      if (!source) continue;
      for (const { pattern, label } of BANNED_KEYWORDS) {
        if (pattern.test(source)) hits.add(label);
      }
    }
    return { banned: hits.size > 0, keywords: [...hits] };
  }

  analyzeMessage(message: {
    subject?: string;
    bodyPreview?: string;
    bodyHtml?: string;
  }): AnalyzeResult {
    const ban = this.detectBanned([message]);
    const code = this.extractCode(message);
    const credit = this.extractCredits(message);
    const kind = ban.banned ? 'ban' : code ? 'code' : credit ? 'credits' : 'normal';
    return {
      code,
      credits: credit?.credits ?? null,
      balance: credit?.balance ?? null,
      banned: ban.banned,
      banKeywords: ban.keywords,
      kind,
    };
  }
}
