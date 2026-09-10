export type MessageKind = 'code' | 'credits' | 'ban' | 'normal';

export interface MailMessage {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview: string;
  /** 已净化，可直接放进 sandbox iframe 的 srcdoc */
  bodyHtml: string;
  /** 命中的验证码 */
  code: string | null;
  /** 命中的额度（credits 数） */
  credits: number | null;
  /** credits / 25 */
  balance: number | null;
  kind: MessageKind;
}

export interface MailboxCredential {
  email: string;
  provider: string;
  authType: string;
  password?: string;
  clientId?: string;
  refreshToken?: string;
  imapHost?: string;
  imapPort?: number;
  /** 邮箱----密码----clientid----refresh_token */
  line?: string;
}

export interface PickupResult {
  key: string;
  email: string;
  ok: boolean;
  error: string | null;
  banned: boolean;
  banReason: string | null;
  banKeywords: string[];
  credits: number | null;
  creditsBalance: number | null;
  latestCode: string | null;
  fetchedAt: string;
  messages: MailMessage[];
}

export interface PickupSummary {
  total: number;
  success: number;
  failed: number;
  banned: number;
  withCredits: number;
}

export interface OpenAiTokenResult {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: Date;
  error?: string;
  /** invalid_grant / unauthorized_client 之类表示凭据已失效 */
  invalidCredential: boolean;
}
