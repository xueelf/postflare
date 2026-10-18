import { type CSSProperties, type ReactNode } from 'react';

import './style.css';

export interface PopoverProps {
  id: string;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerLabel: string;
  triggerTitle?: string;
  side?: 'top' | 'bottom';
  children: ReactNode;
}

/**
 * 弹出层：原生 popover + 锚点定位，触发按钮与弹层成对封装。
 */
export function Popover({
  id,
  trigger,
  triggerClassName,
  triggerLabel,
  triggerTitle,
  side = 'bottom',
  children,
}: PopoverProps) {
  const anchorName = `--${id}`;

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        style={{ anchorName } as CSSProperties}
        popoverTarget={id}
        aria-label={triggerLabel}
        title={triggerTitle}
      >
        {trigger}
      </button>
      <div
        id={id}
        popover="auto"
        className={`popover popover-${side}`}
        style={{ positionAnchor: anchorName } as CSSProperties}
      >
        {children}
      </div>
    </>
  );
}
