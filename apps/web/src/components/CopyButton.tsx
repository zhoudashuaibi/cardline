import { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';

/**
 * 复制文本到剪贴板；优先 clipboard API，失败时回落到 `execCommand`。
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  if (!value) return false;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* 继续走回落方案 */
  }

  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export interface CopyButtonProps {
  /** 要复制的内容 */
  value: string;
  /** 按钮文案，省略则只显示图标 */
  label?: string;
  size?: 'small' | 'middle' | 'large';
  type?: 'link' | 'text' | 'default' | 'primary' | 'dashed';
  disabled?: boolean;
  className?: string;
  title?: string;
  /** 复制成功后的回调（用于弹出 message） */
  onCopied?: (ok: boolean) => void;
}

/**
 * 带成功反馈的复制按钮。
 */
export default function CopyButton({
  value,
  label,
  size = 'small',
  type = 'link',
  disabled = false,
  className,
  title,
  onCopied,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleClick = async () => {
    const ok = await copyToClipboard(value);
    onCopied?.(ok);
    if (!ok) return;

    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Button
      type={type}
      size={size}
      disabled={disabled || !value}
      className={className}
      title={title ?? (label ? label : '复制')}
      icon={copied ? <CheckOutlined /> : <CopyOutlined />}
      onClick={() => {
        void handleClick();
      }}
    >
      {label ? (copied ? '已复制' : label) : null}
    </Button>
  );
}
