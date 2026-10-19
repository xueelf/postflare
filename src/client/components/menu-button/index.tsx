import { RiMenuLine } from '@remixicon/react';

import { useI18n } from '#/client/i18n';

import { Button } from '../button';

/**
 * 移动端抽屉入口按钮（桌面隐藏，规则见 layout/style.css）。
 */
export function MenuButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();

  return (
    <Button
      variant="icon"
      className="menu-btn"
      onClick={onClick}
      aria-label={t('ui.openMenu')}
    >
      <RiMenuLine size={20} aria-hidden />
    </Button>
  );
}
