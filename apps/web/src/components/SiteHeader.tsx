import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockOutlined } from '@ant-design/icons';

import { getPublicMeta } from '../api/client';
import BrandMark from './BrandMark';
import StatusDot from './StatusDot';

const POLL_INTERVAL_MS = 30_000;

/**
 * 公共站点顶部导航（sticky，白底 + 1px 分隔线）。
 *
 * 状态圆点轮询 `GET /api/public/meta`：成功显示「服务在线」，失败显示「服务离线」。
 */
export default function SiteHeader() {
  const navigate = useNavigate();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const ping = () => {
      getPublicMeta()
        .then(() => {
          if (!cancelled) setOnline(true);
        })
        .catch(() => {
          if (!cancelled) setOnline(false);
        });
    };

    ping();
    const timer = window.setInterval(ping, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const tone = online === null ? 'idle' : online ? 'ok' : 'danger';
  const label = online === null ? '检测中' : online ? '服务在线' : '服务离线';

  return (
    <header className="site-header">
      <div className="shell site-header__inner">
        <BrandMark />

        <div className="site-header__right">
          <StatusDot tone={tone} pulse={online === true} label={label} />
          <button
            type="button"
            className="ghost-button"
            onClick={() => navigate('/admin')}
            aria-label="进入管理后台"
          >
            <LockOutlined className="ghost-button__glyph" />
            管理入口
          </button>
        </div>
      </div>
    </header>
  );
}
