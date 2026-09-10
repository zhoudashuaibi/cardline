export type ErrorCode =
  | 'BAD_INPUT'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CARD_INVALID'
  | 'CARD_DISABLED'
  | 'CREDITS_PENDING'
  | 'NO_STOCK'
  | 'PICKUP_FAILED'
  | 'UPSTREAM_ERROR'
  | 'CONFLICT'
  | 'INTERNAL';

export type DeliverFormat = 'sub2api' | 'cpa' | 'email';
export type BanStatus = 'unknown' | 'normal' | 'banned' | 'invalid';
export type RedeemStatus = 'unredeemed' | 'redeemed';
export type ImportSource = 'paste' | 'upload';
export type MessageKind = 'code' | 'credits' | 'ban' | 'normal';

export const DELIVER_FORMATS: DeliverFormat[] = ['sub2api', 'cpa', 'email'];
export const BAN_STATUSES: BanStatus[] = ['unknown', 'normal', 'banned', 'invalid'];
export const REDEEM_STATUSES: RedeemStatus[] = ['unredeemed', 'redeemed'];

export const FORMAT_META: Record<
  DeliverFormat,
  { label: string; ext: string; title: string; hint: string }
> = {
  sub2api: {
    label: 'sub2api',
    ext: 'json',
    title: 'sub2api',
    hint: 'sub2api 导入 JSON（exported_at / proxies / accounts）',
  },
  cpa: {
    label: 'CPA',
    ext: 'json',
    title: 'CPA',
    hint: 'Codex CPA auth JSON（type: codex + access_token/id_token）',
  },
  email: {
    label: '邮箱 TXT',
    ext: 'txt',
    title: '邮箱 TXT',
    hint: '邮箱----密码----clientid----refresh_token',
  },
};
