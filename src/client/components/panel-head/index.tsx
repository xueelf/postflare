import { RiMenuLine, RiSearchLine } from '@remixicon/react';
import type { ReactNode } from 'react';

import { Button } from '#/client/components/button';
import { MenuButton } from '#/client/components/menu-button';
import { useI18n } from '#/client/i18n';

export interface PanelHeadProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onMenu: () => void;
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  children?: ReactNode;
}

/**
 * 面板头部：移动端菜单、侧栏折叠、常驻搜索与右侧动作，列表、用户等面板共用。
 */
export function PanelHead({
  collapsed,
  onToggleSidebar,
  onMenu,
  search,
  onSearch,
  searchPlaceholder,
  children,
}: PanelHeadProps) {
  const { t } = useI18n();
  const toggleLabel = collapsed
    ? t('mail.expandSidebar')
    : t('mail.collapseSidebar');

  return (
    <>
      <div className="panel-head">
        <MenuButton onClick={onMenu} />
        <Button
          variant="icon"
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <RiMenuLine size={20} aria-hidden />
        </Button>
        <search className="search">
          <RiSearchLine size={20} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={event => onSearch(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </search>
        {children}
      </div>
      <hr />
    </>
  );
}
