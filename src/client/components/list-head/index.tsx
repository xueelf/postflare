import { RiMenuLine, RiSearchLine } from '@remixicon/react';

import { AccountMenu } from '../account-menu';
import { Button } from '../button';
import { MenuButton } from '../menu-button';

export interface ListHeadProps {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onMenu: () => void;
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  accountMenuId: string;
  user: { name: string; email: string };
  onCreateTemplate: () => void;
  onLogout: () => void;
}

/**
 * 列表面板头部：移动端菜单、侧栏折叠、常驻搜索与账户入口。
 */
export function ListHead({
  collapsed,
  onToggleSidebar,
  onMenu,
  search,
  onSearch,
  searchPlaceholder,
  accountMenuId,
  user,
  onCreateTemplate,
  onLogout,
}: ListHeadProps) {
  const toggleLabel = collapsed ? '展开侧栏' : '折叠侧栏';

  return (
    <>
      <div className="list-head">
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
        <div className="account-mobile">
          <AccountMenu
            id={accountMenuId}
            user={user}
            onCreateTemplate={onCreateTemplate}
            onLogout={onLogout}
          />
        </div>
      </div>
      <hr />
    </>
  );
}
