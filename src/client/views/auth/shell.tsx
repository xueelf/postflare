import type { ReactNode } from 'react';

import { Logo } from '#/client/components/logo';

import './style.css';

export interface AuthShellProps {
  children: ReactNode;
}

/**
 * 登录、创建账号、设置密码三个页面共用的外壳：水印 + 品牌头 + 内容。
 */
export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="auth-wrap">
      <Logo className="auth-watermark" size={320} />
      <div className="auth-stage">
        <header className="auth-head">
          <div className="auth-brand">
            <Logo className="auth-logo" size={40} />
            <span className="auth-name">Postflare</span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
