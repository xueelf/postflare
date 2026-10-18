import type { ReactNode } from 'react';

import './style.css';

export interface EmptyStateProps {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}

/**
 * 空状态：图标 + 文案 + 可选操作，整体居中。
 * 图标尺寸由组件统一控制，调用点只传图标本身。
 */
export function EmptyState({ icon, children, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <p className="empty-text">{children}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
