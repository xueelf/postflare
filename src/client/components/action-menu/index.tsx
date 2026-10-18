import type { ReactNode } from 'react';

import { Button } from '../button';

export interface ActionMenuProps {
  className?: string;
  disabled?: boolean;
  items: Array<{ label: string; icon: ReactNode; run: () => void }>;
}

/**
 * 图标动作组：阅读器、模板预览与用户列表共用。
 */
export function ActionMenu({ className, disabled, items }: ActionMenuProps) {
  return (
    <menu className={className}>
      {items.map(item => (
        <li key={item.label}>
          <Button
            variant="icon"
            aria-label={item.label}
            title={item.label}
            disabled={disabled}
            onClick={item.run}
          >
            {item.icon}
          </Button>
        </li>
      ))}
    </menu>
  );
}
