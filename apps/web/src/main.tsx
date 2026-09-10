import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

import 'antd/dist/reset.css';
import './styles/global.css';

import App from './App';
import { AuthProvider } from './hooks/useAuth';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('未找到 #root 挂载节点');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1F4A3C',
          borderRadius: 8,
          colorBgLayout: '#F2F2EF',
          fontFamily:
            "'Inter', -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
