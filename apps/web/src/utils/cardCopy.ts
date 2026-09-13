/**
 * 批量复制卡密（后台「卡密管理」/「账号列表」共用）。
 *
 * 文本统一由服务端拼好（一行一个卡密，顺带累加 `copyCount`），
 * 前端只负责写入剪贴板 + 给出提示。
 */

import { copyCards } from '../api/client';
import type { CopyCardsRequest } from '../api/types';
import { copyToClipboard } from '../components/CopyButton';

/** 复制范围：勾选行 / 当前页 / 当前筛选全部（跨分页） */
export type CardCopyScope = 'selected' | 'page' | 'filtered';

export interface CardCopyOutcome {
  /** 接口返回的卡密数量 */
  count: number;
  /** 命中筛选的总条数 */
  total: number;
  /** 命中条数超过单次上限被截断 */
  truncated: boolean;
  /** 是否成功写入剪贴板 */
  copied: boolean;
}

/** 调用接口取卡密文本并写剪贴板 */
export async function copyCardKeys(payload: CopyCardsRequest): Promise<CardCopyOutcome> {
  const response = await copyCards(payload);
  const copied = response.count > 0 ? await copyToClipboard(response.text) : false;
  return {
    count: response.count,
    total: response.total,
    truncated: response.truncated,
    copied,
  };
}

/** 极简的 message 接口（避免为了类型引入 antd 的 MessageInstance） */
export interface CopyMessageApi {
  success: (content: string) => void;
  warning: (content: string) => void;
}

/** 统一的复制结果提示 */
export function reportCardCopy(outcome: CardCopyOutcome, message: CopyMessageApi, scope: CardCopyScope) {
  const scopeLabel = scope === 'selected' ? '选中' : scope === 'page' ? '本页' : '筛选结果';

  if (outcome.count === 0) {
    message.warning(`${scopeLabel}没有可复制的卡密`);
    return;
  }
  if (!outcome.copied) {
    message.warning('剪贴板不可用，请改用「导出」下载卡密');
    return;
  }
  if (outcome.truncated) {
    message.warning(
      `已复制 ${outcome.count} 张卡密（${scopeLabel}共 ${outcome.total} 张，超出单次上限已截断）`,
    );
    return;
  }
  message.success(`已复制 ${outcome.count} 张卡密`);
}
