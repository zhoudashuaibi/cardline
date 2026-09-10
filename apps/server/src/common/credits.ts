/**
 * 额度档位换算：账号额度只来自「邮箱取件命中关键字」，不接受人工填写。
 *
 * 邮件里命中的是原始 credits（例如 `we've added 1000 credits`、`添加了 1000 额度`），
 * 对外售卖的档位是余额：credits ÷ 25（与前台取件页展示的「余额」口径一致）。
 *
 * 约定：档位 0 = 待定档（还没取到件 / 取件成功但没命中额度关键字），
 * 待定档账号不进前台兑换池。
 */

/** 邮件原始 credits → 档位的进制 */
export const CREDITS_PER_TIER = 25;

/** 待定档哨兵值 */
export const PENDING_TIER = 0;

/** 邮件命中额度 → 档位（向下取整，绝不多算，避免把不足 1 档的额度当成整档卖出去） */
export function tierFromMailCredits(credits: number | null | undefined): number {
  const value = Number(credits);
  if (!Number.isFinite(value) || value <= 0) return PENDING_TIER;
  const tier = Math.floor(value / CREDITS_PER_TIER);
  return tier > 0 ? tier : PENDING_TIER;
}

/** 是否待定档（0 / 空 / 非法值都算待定档） */
export function isPendingTier(credits: number | null | undefined): boolean {
  const value = Number(credits);
  return !Number.isFinite(value) || value <= 0;
}

/** 档位展示文案 */
export function formatTier(credits: number | null | undefined): string {
  return isPendingTier(credits) ? '待定档' : `${Math.trunc(Number(credits))} 额度`;
}
