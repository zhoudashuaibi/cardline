export type StatusTone = 'ok' | 'warn' | 'danger' | 'idle';

export interface StatusDotProps {
  label: string;
  tone?: StatusTone;
  /** 呼吸动画（在线状态） */
  pulse?: boolean;
  className?: string;
}

/**
 * 小圆点 + 文案，用于在线状态 / 交付节点等指示。
 */
export default function StatusDot({ label, tone = 'idle', pulse = false, className }: StatusDotProps) {
  const classes = [
    'status-dot',
    `status-dot--${tone}`,
    pulse ? 'status-dot--pulse' : '',
    className ?? '',
  ]
    .join(' ')
    .trim();

  return (
    <span className={classes}>
      <span className="status-dot__dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
