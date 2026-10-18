import { RiMenuLine } from '@remixicon/react';

import { Button } from './button';

/**
 * 移动端抽屉入口按钮（桌面隐藏，规则见 layout/style.css）。
 */
export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="icon"
      className="menu-btn"
      onClick={onClick}
      aria-label="打开菜单"
    >
      <RiMenuLine size={20} aria-hidden />
    </Button>
  );
}
