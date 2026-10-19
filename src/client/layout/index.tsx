import type { ReactNode } from 'react';

import { useI18n } from '#/client/i18n';

import { type SidebarProps, Sidebar } from './sidebar';

import './style.css';

export interface LayoutProps extends SidebarProps {
  drawerOpen: boolean;
  onDrawerClose: () => void;
  readerOpen: boolean;
  children?: ReactNode;
}

/**
 * 应用布局由侧栏与内容区组成，内容区在宽屏下是列表与阅读双栏，窄屏切换为单栏。
 */
export function Layout({
  drawerOpen,
  onDrawerClose,
  readerOpen,
  children,
  ...sidebar
}: LayoutProps) {
  const { t } = useI18n();

  return (
    <div className="shell">
      <aside
        className={[
          'sidebar',
          drawerOpen ? 'open' : '',
          sidebar.collapsed ? 'collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Sidebar {...sidebar} />
      </aside>
      {drawerOpen && (
        <button
          type="button"
          className="backdrop"
          aria-label={t('ui.close')}
          onClick={onDrawerClose}
        />
      )}
      <main className={readerOpen ? 'workspace reader-open' : 'workspace'}>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
