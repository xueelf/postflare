import type { ReactNode } from 'react';

import './style.css';

export interface EmptyStateProps {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}

/**
 * 空状态由图标、文案与可选操作组成，整体居中。
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
