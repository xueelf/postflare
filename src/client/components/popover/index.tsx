import { type CSSProperties, type ReactNode } from 'react';

import './style.css';

export interface PopoverProps {
  id: string;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerLabel: string;
  triggerTitle?: string;
  side?: 'top' | 'bottom';
  /** 指定外部锚点元素，弹层不再以触发按钮定位。 */
  anchorName?: string;
  /** 追加到弹层容器的类名。 */
  popoverClassName?: string;
  children: ReactNode;
}

/**
 * 弹出层基于原生 popover 与锚点定位，触发按钮与弹层成对封装。
 */
export function Popover({
  id,
  trigger,
  triggerClassName,
  triggerLabel,
  triggerTitle,
  side = 'bottom',
  anchorName,
  popoverClassName,
  children,
}: PopoverProps) {
  const triggerAnchorName = `--${id}`;
  const positionAnchor = anchorName ?? triggerAnchorName;
  const className = ['popover', `popover-${side}`, popoverClassName]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        style={
          anchorName
            ? undefined
            : ({ anchorName: triggerAnchorName } as CSSProperties)
        }
        popoverTarget={id}
        aria-label={triggerLabel}
        title={triggerTitle}
      >
        {trigger}
      </button>
      <div
        id={id}
        popover="auto"
        className={className}
        style={{ positionAnchor } as CSSProperties}
      >
        {children}
      </div>
    </>
  );
}
