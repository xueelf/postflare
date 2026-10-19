import { AccountMenu } from '../account-menu';
import { PanelHead } from '../panel-head';

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
 * 列表面板头部：面板头部加移动端的账户入口。
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
  return (
    <PanelHead
      collapsed={collapsed}
      onToggleSidebar={onToggleSidebar}
      onMenu={onMenu}
      search={search}
      onSearch={onSearch}
      searchPlaceholder={searchPlaceholder}
    >
      <div className="account-mobile">
        <AccountMenu
          id={accountMenuId}
          user={user}
          onCreateTemplate={onCreateTemplate}
          onLogout={onLogout}
        />
      </div>
    </PanelHead>
  );
}
