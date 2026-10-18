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

import pkg from '../../../package.json';
import { AccountMenu } from '../components/account-menu';
import { Popover } from '../components/popover';
import type { View } from '../route';

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
    label: string;
    icon: ReactNode;
    count?: 'unread' | 'drafts' | 'spam_unread';
    ownerOnly?: boolean;
  }>
> = [
  [
    {
      view: 'inbox',
      label: '收件箱',
      icon: <RiInboxLine size={20} />,
      count: 'unread',
    },
    {
      view: 'drafts',
      label: '草稿',
      icon: <RiDraftLine size={20} />,
      count: 'drafts',
    },
    { view: 'sent', label: '已发送', icon: <RiSendPlaneLine size={20} /> },
    {
      view: 'spam',
      label: '垃圾邮件',
      icon: <RiMailForbidLine size={20} />,
      count: 'spam_unread',
    },
    { view: 'trash', label: '回收站', icon: <RiDeleteBinLine size={20} /> },
  ],
  [
    { view: 'templates', label: '模板', icon: <RiFileTextLine size={20} /> },
    {
      view: 'users',
      label: '用户',
      icon: <RiGroupLine size={20} />,
      ownerOnly: true,
    },
  ],
];

/**
 * 侧栏：账户、写邮件、文件夹导航与帮助。
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
        title={collapsed ? '写邮件' : undefined}
      >
        <span className="nav-icon">
          <RiEditLine size={20} aria-hidden />
        </span>
        <span className="nav-label">写邮件</span>
      </button>

      <nav className="nav" aria-label="文件夹">
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
                        title={collapsed ? item.label : undefined}
                      >
                        <span className="nav-icon">
                          {item.icon}
                          {count > 0 && (
                            <span className="dot-badge" aria-hidden="true" />
                          )}
                        </span>
                        <span className="nav-label">{item.label}</span>
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
              title={collapsed ? '设置' : undefined}
            >
              <span className="nav-icon">
                <RiSettings3Line size={20} aria-hidden />
              </span>
              <span className="nav-label">设置</span>
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
              triggerLabel="帮助"
              triggerTitle={collapsed ? '帮助' : undefined}
              side="top"
              trigger={
                <>
                  <span className="nav-icon">
                    <RiQuestionLine size={20} aria-hidden />
                  </span>
                  <span className="nav-label">帮助</span>
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
                <span>项目仓库</span>
              </a>
              <a
                className="popover-item"
                href="https://github.com/xueelf/postflare/issues"
                target="_blank"
                rel="noreferrer"
              >
                <RiBugLine size={20} aria-hidden />
                <span>问题反馈</span>
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
