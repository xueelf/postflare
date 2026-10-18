import type { ReactNode } from 'react';

import './style.css';

export interface DialogHeadProps {
  title: string;
  /** 右侧图标按钮：弹窗放关闭，卡片放说明 */
  children?: ReactNode;
}

/**
 * 弹窗与卡片共用的头部：左侧 40px 占位让标题相对整体居中，右侧放图标按钮。
 */
export function DialogHead({ title, children }: DialogHeadProps) {
  return (
    <div className="dialog-head">
      <span className="dialog-lead" aria-hidden="true" />
      <h2>{title}</h2>
      {/* 没有右侧按钮时补一个等宽占位，标题保持居中 */}
      {children ?? <span className="dialog-lead" aria-hidden="true" />}
    </div>
  );
}
