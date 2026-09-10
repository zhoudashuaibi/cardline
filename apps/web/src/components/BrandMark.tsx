import type { CSSProperties } from 'react';

export interface BrandMarkProps {
  /** 方块边长，默认 34 */
  size?: number;
  /** 是否渲染右侧文字 */
  showText?: boolean;
  /** 主标题 */
  name?: string;
  /** 副标题（大写微文案） */
  subtitle?: string;
  /** 深色底（后台侧边栏）场景 */
  tone?: 'light' | 'dark';
  className?: string;
}

/**
 * 「C」方块 Logo + 品牌文字。
 */
export default function BrandMark({
  size = 34,
  showText = true,
  name = 'Cardline',
  subtitle = 'SECURE DELIVERY',
  tone = 'light',
  className,
}: BrandMarkProps) {
  const markStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(6, Math.round(size * 0.235)),
    fontSize: Math.round(size * 0.53),
  };

  return (
    <span className={['brand', tone === 'dark' ? 'brand--dark' : '', className ?? ''].join(' ').trim()}>
      <span className="brand__mark" style={markStyle} aria-hidden="true">
        C
      </span>
      {showText ? (
        <span className="brand__text">
          <span className="brand__name">{name}</span>
          {subtitle ? <span className="brand__sub">{subtitle}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
