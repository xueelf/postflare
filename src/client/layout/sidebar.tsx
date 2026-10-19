import {
  RiBugLine,
  RiDeleteBinLine,
  RiDraftLine,
  RiEditLine,
  RiFileTextLine,
  RiGithubLine,
  RiGroupLine,
  RiInboxLine,
  RiMailForbidLine,
  RiQuestionLine,
  RiSendPlaneLine,
  RiSettings3Line,
} from '@remixicon/react';
import { type ReactNode, Fragment } from 'react';

import { AccountMenu } from '#/client/components/account-menu';
import { Popover } from '#/client/components/popover';
import { type MessageKey, useI18n } from '#/client/i18n';
import type { View } from '#/client/route';
import pkg from '~/package.json';

export interface SidebarProps {
  collapsed: boolean;
  user: { name: string; email: string; role: 'owner' | 'user' };
  view: View;
  counts: { unread: number; drafts: number; spam_unread: number };
  settingsOpen: boolean;
  onNavigate: (view: View) => void;
  onCompose: () => void;
  onCreateTemplate: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

const NAV_GROUPS: Array<
  Array<{
    view: View;
    labelKey: MessageKey;
    icon: ReactNode;
    count?: 'unread' | 'drafts' | 'spam_unread';
    ownerOnly?: boolean;
  }>
> = [
  [
    {
      view: 'inbox',
      labelKey: 'sidebar.inbox',
      icon: <RiInboxLine size={20} />,
      count: 'unread',
    },
    {
      view: 'drafts',
      labelKey: 'sidebar.drafts',
      icon: <RiDraftLine size={20} />,
      count: 'drafts',
    },
    {
      view: 'sent',
      labelKey: 'sidebar.sent',
      icon: <RiSendPlaneLine size={20} />,
    },
    {
      view: 'spam',
      labelKey: 'sidebar.spam',
      icon: <RiMailForbidLine size={20} />,
      count: 'spam_unread',
    },
    {
      view: 'trash',
      labelKey: 'sidebar.trash',
      icon: <RiDeleteBinLine size={20} />,
    },
  ],
  [
    {
      view: 'templates',
      labelKey: 'sidebar.templates',
      icon: <RiFileTextLine size={20} />,
    },
    {
      view: 'users',
      labelKey: 'sidebar.users',
      icon: <RiGroupLine size={20} />,
      ownerOnly: true,
    },
  ],
];

/**
 * 侧栏包含账户入口、写邮件按钮、文件夹导航与帮助。
 */
export function Sidebar({
  collapsed,
  user,
  view,
  counts,
  settingsOpen,
  onNavigate,
  onCompose,
  onCreateTemplate,
  onOpenSettings,
  onLogout,
}: SidebarProps) {
  const { t } = useI18n();

  return (
    <>
      <div className="sidebar-head">
        <AccountMenu
          id="account-menu"
          user={user}
          onCreateTemplate={onCreateTemplate}
          onLogout={onLogout}
        />
      </div>

      <button
        type="button"
        className="compose"
        onClick={onCompose}
        title={collapsed ? t('sidebar.compose') : undefined}
      >
        <span className="nav-icon">
          <RiEditLine size={20} aria-hidden />
        </span>
        <span className="nav-label">{t('sidebar.compose')}</span>
      </button>

      <nav className="nav" aria-label={t('sidebar.folders')}>
        {NAV_GROUPS.map((group, index) => (
          <Fragment key={index}>
            {index > 0 && <hr className="nav-divider" />}
            <ul>
              {group
                .filter(item => !item.ownerOnly || user.role === 'owner')
                .map(item => {
                  const count = item.count ? counts[item.count] : 0;

                  return (
                    <li key={item.view}>
                      <button
                        type="button"
                        className={view === item.view ? 'active' : undefined}
                        onClick={() => onNavigate(item.view)}
                        title={collapsed ? t(item.labelKey) : undefined}
                      >
                        <span className="nav-icon">
                          {item.icon}
                          {count > 0 && (
                            <span className="dot-badge" aria-hidden="true" />
                          )}
                        </span>
                        <span className="nav-label">{t(item.labelKey)}</span>
                        {count > 0 && <small className="badge">{count}</small>}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </Fragment>
        ))}
        {/* 设置是锚点弹窗而非视图，单独一项 */}
        <hr className="nav-divider" />
        <ul>
          <li>
            <button
              type="button"
              className={settingsOpen ? 'active' : undefined}
              onClick={onOpenSettings}
              title={collapsed ? t('sidebar.settings') : undefined}
            >
              <span className="nav-icon">
                <RiSettings3Line size={20} aria-hidden />
              </span>
              <span className="nav-label">{t('sidebar.settings')}</span>
            </button>
          </li>
        </ul>
      </nav>

      <div className="sidebar-help">
        <hr className="nav-divider" />
        <ul>
          <li>
            <Popover
              id="help-menu"
              triggerLabel={t('sidebar.help')}
              triggerTitle={collapsed ? t('sidebar.help') : undefined}
              side="top"
              trigger={
                <>
                  <span className="nav-icon">
                    <RiQuestionLine size={20} aria-hidden />
                  </span>
                  <span className="nav-label">{t('sidebar.help')}</span>
                </>
              }
            >
              <a
                className="popover-item"
                href="https://github.com/xueelf/postflare"
                target="_blank"
                rel="noreferrer"
              >
                <RiGithubLine size={20} aria-hidden />
                <span>{t('sidebar.repository')}</span>
              </a>
              <a
                className="popover-item"
                href="https://github.com/xueelf/postflare/issues"
                target="_blank"
                rel="noreferrer"
              >
                <RiBugLine size={20} aria-hidden />
                <span>{t('sidebar.issues')}</span>
              </a>
              <div className="popover-note help-menu-version">
                v{pkg.version}
              </div>
            </Popover>
          </li>
        </ul>
        <span className="help-version">v{pkg.version}</span>
      </div>
    </>
  );
}
