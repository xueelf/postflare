import type { ReactNode } from 'react';

import './style.css';

export interface NoticeProps {
  children: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}

/**
 * 提示块：页面与表单里的说明，带底色与描边（同组件库的 Alert）。
 * 与表单的间距由调用方给，组件本身不带外边距。
 */
export function Notice({ children, role, className }: NoticeProps) {
  return (
    <div
      className={['notice', className].filter(Boolean).join(' ')}
      role={role}
    >
      {children}
    </div>
  );
}
