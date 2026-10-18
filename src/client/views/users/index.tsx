import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiForbidLine,
  RiGroupLine,
  RiKey2Line,
  RiLink,
  RiSearchLine,
} from '@remixicon/react';
import { type ReactNode, useId, useState } from 'react';

import { ActionMenu } from '../../components/action-menu';
import { Button } from '../../components/button';
import { EmptyState } from '../../components/empty-state';
import { FormItem } from '../../components/form-item';
import { Modal } from '../../components/modal';
import { useToast } from '../../components/toast';
import { dateTimeValue, formatDate } from '../../format';
import type { ConfirmRequest } from '../../hooks/use-confirm';
import {
  type IssuedLink,
  type UserSummary,
  useUsers,
} from '../../hooks/use-users';

import './style.css';

const STATUS_LABELS: Record<UserSummary['status'], string> = {
  invited: '待注册',
  active: '正常',
  disabled: '已停用',
};

export interface UsersProps {
  mailDomain: string;
  askConfirm: (request: ConfirmRequest) => void;
}

/**
 * 用户管理：仅所有者可见，列表、新建、启用停用、删除与一次性链接。
 */
export function Users({ mailDomain, askConfirm }: UsersProps) {
  const { users, busy, create, setStatus, remove, issueLink } = useUsers();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<IssuedLink | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? users.filter(
        user =>
          user.email.toLowerCase().includes(needle) ||
          user.name.toLowerCase().includes(needle),
      )
    : users;

  const openLink = (id: string) => {
    issueLink(id).then(issued => {
      if (issued) {
        setLink(issued);
      }
    });
  };

  const askDisable = (user: UserSummary) => {
    askConfirm({
      title: '停用这个邮箱？',
      message: `停用后 ${user.email} 不再接收新邮件，发件方会收到退信，也无法登录。已有邮件会保留，可随时重新启用。`,
      confirmText: '停用',
      action: () => {
        setStatus(user.id, 'disabled');
      },
    });
  };

  const askRemove = (user: UserSummary) => {
    askConfirm({
      title: '删除这个用户？',
      message: `删除后 ${user.email} 的账号、邮件、附件与模板会一并清除，无法恢复。`,
      confirmText: '删除',
      danger: true,
      action: () => {
        remove(user.id);
      },
    });
  };

  const rowActions = (user: UserSummary) => {
    const actions: Array<{
      label: string;
      icon: ReactNode;
      run: () => void;
    }> = [];

    // 自己（所有者）不能停用或删除，改密码走设置
    if (user.role === 'owner') {
      return actions;
    }

    if (user.status === 'invited') {
      actions.push({
        label: '注册链接',
        icon: <RiLink size={20} aria-hidden />,
        run: () => openLink(user.id),
      });
    } else {
      actions.push(
        user.status === 'active'
          ? {
              label: '停用',
              icon: <RiForbidLine size={20} aria-hidden />,
              run: () => askDisable(user),
            }
          : {
              label: '启用',
              icon: <RiCheckLine size={20} aria-hidden />,
              run: () => {
                setStatus(user.id, 'active');
              },
            },
      );

      actions.push({
        label: '重置密码',
        icon: <RiKey2Line size={20} aria-hidden />,
        run: () => openLink(user.id),
      });
    }

    actions.push({
      label: '删除用户',
      icon: <RiDeleteBinLine size={20} aria-hidden />,
      run: () => askRemove(user),
    });

    return actions;
  };

  return (
    <section className="panel users-pane" aria-label="用户管理">
      <div className="panel-head">
        <search className="search">
          <RiSearchLine size={20} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="搜索邮箱或昵称"
            aria-label="搜索用户"
            onChange={event => setQuery(event.target.value)}
          />
        </search>
        <Button
          variant="primary"
          className="users-create"
          onClick={() => setCreating(true)}
        >
          <RiAddLine size={20} aria-hidden />
          新建用户
        </Button>
      </div>
      <hr />
      <div className="panel-body">
        {visible.length === 0 ? (
          <EmptyState icon={<RiGroupLine aria-hidden />}>
            {needle ? '没有匹配的用户' : '还没有其他用户'}
          </EmptyState>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>昵称</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>
                  <span className="users-sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map(user => (
                <tr
                  key={user.id}
                  className={user.status === 'disabled' ? 'off' : undefined}
                >
                  <td className="users-email">{user.email}</td>
                  <td>{user.name}</td>
                  <td>
                    <span className={`users-state ${user.status}`}>
                      {STATUS_LABELS[user.status]}
                    </span>
                  </td>
                  <td className="users-when">
                    <time dateTime={dateTimeValue(user.created_at)}>
                      {formatDate(user.created_at)}
                    </time>
                  </td>
                  <td className="users-actions">
                    <ActionMenu disabled={busy} items={rowActions(user)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <CreateDialog
          busy={busy}
          mailDomain={mailDomain}
          onCreate={create}
          onCreated={issued => {
            setCreating(false);
            setLink(issued);
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {link && <LinkDialog issued={link} onClose={() => setLink(null)} />}
    </section>
  );
}

/**
 * 新建用户：只填用户名与昵称，密码由对方通过一次性链接自行设置。
 */
function CreateDialog({
  busy,
  mailDomain,
  onCreate,
  onCreated,
  onClose,
}: {
  busy: boolean;
  mailDomain: string;
  onCreate: (username: string, name: string) => Promise<IssuedLink | null>;
  onCreated: (issued: IssuedLink) => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const formId = useId();
  const clean = username.trim();

  return (
    <Modal
      title="新建用户"
      onDismiss={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || !clean || !name.trim()}
          >
            {busy ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={event => {
          event.preventDefault();

          onCreate(clean, name.trim()).then(issued => {
            if (issued) {
              onCreated(issued);
            }
          });
        }}
      >
        <FormItem
          label={
            <>
              <span>用户名</span>
              {clean && (
                <span className="form-ref">
                  {clean}@{mailDomain}
                </span>
              )}
            </>
          }
        >
          <input
            value={username}
            required
            autoComplete="off"
            onChange={event => setUsername(event.target.value)}
          />
        </FormItem>
        <FormItem label="昵称">
          <input
            value={name}
            required
            autoComplete="nickname"
            onChange={event => setName(event.target.value)}
          />
        </FormItem>
      </form>
    </Modal>
  );
}

/**
 * 一次性链接：注册与重置共用，展示地址并支持复制。
 */
function LinkDialog({
  issued,
  onClose,
}: {
  issued: IssuedLink;
  onClose: () => void;
}) {
  const toast = useToast();
  const invite = issued.purpose === 'invite';

  const copy = () => {
    navigator.clipboard.writeText(issued.url).then(
      () => toast.success('链接已复制'),
      () => toast.error('复制失败，请手动复制'),
    );
  };

  return (
    <Modal
      title={invite ? '注册链接' : '重置链接'}
      onDismiss={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          完成
        </Button>
      }
    >
      <p className="users-text">
        {invite
          ? '把下面的链接发给对方，打开后设置自己的密码。链接 24 小时后失效，仅可使用一次。'
          : '把下面的链接发给对方，打开后重设密码。链接 1 小时后失效，仅可使用一次。'}
      </p>
      <div className="users-link">
        <input
          readOnly
          value={issued.url}
          aria-label="一次性链接"
          onFocus={event => event.target.select()}
        />
        <Button
          variant="icon"
          aria-label="复制链接"
          title="复制链接"
          onClick={copy}
        >
          <RiFileCopyLine size={20} aria-hidden />
        </Button>
      </div>
    </Modal>
  );
}
