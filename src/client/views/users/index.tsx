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
import { type MessageKey, useI18n } from '../../i18n';

import './style.css';

const STATUS_KEYS: Record<UserSummary['status'], MessageKey> = {
  invited: 'users.statusInvited',
  active: 'users.statusActive',
  disabled: 'users.statusDisabled',
};

export interface UsersProps {
  mailDomain: string;
  askConfirm: (request: ConfirmRequest) => void;
}

/**
 * 用户管理：仅所有者可见，列表、新建、启用停用、删除与一次性链接。
 */
export function Users({ mailDomain, askConfirm }: UsersProps) {
  const { locale, t } = useI18n();
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
      title: t('users.disableTitle'),
      message: t('users.disableMessage', { email: user.email }),
      confirmText: t('users.disable'),
      action: () => {
        setStatus(user.id, 'disabled');
      },
    });
  };

  const askRemove = (user: UserSummary) => {
    askConfirm({
      title: t('users.removeTitle'),
      message: t('users.removeMessage', { email: user.email }),
      confirmText: t('users.delete'),
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
        label: t('users.inviteLink'),
        icon: <RiLink size={20} aria-hidden />,
        run: () => openLink(user.id),
      });
    } else {
      actions.push(
        user.status === 'active'
          ? {
              label: t('users.disable'),
              icon: <RiForbidLine size={20} aria-hidden />,
              run: () => askDisable(user),
            }
          : {
              label: t('users.enable'),
              icon: <RiCheckLine size={20} aria-hidden />,
              run: () => {
                setStatus(user.id, 'active');
              },
            },
      );

      actions.push({
        label: t('users.resetPassword'),
        icon: <RiKey2Line size={20} aria-hidden />,
        run: () => openLink(user.id),
      });
    }

    actions.push({
      label: t('users.deleteUser'),
      icon: <RiDeleteBinLine size={20} aria-hidden />,
      run: () => askRemove(user),
    });

    return actions;
  };

  return (
    <section className="panel users-pane" aria-label={t('users.title')}>
      <div className="panel-head">
        <search className="search">
          <RiSearchLine size={20} aria-hidden />
          <input
            type="search"
            value={query}
            placeholder={t('users.searchPlaceholder')}
            aria-label={t('users.search')}
            onChange={event => setQuery(event.target.value)}
          />
        </search>
        <Button
          variant="primary"
          className="users-create"
          onClick={() => setCreating(true)}
        >
          <RiAddLine size={20} aria-hidden />
          {t('users.newUser')}
        </Button>
      </div>
      <hr />
      <div className="panel-body">
        {visible.length === 0 ? (
          <EmptyState icon={<RiGroupLine aria-hidden />}>
            {needle ? t('users.noMatch') : t('users.empty')}
          </EmptyState>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>{t('users.email')}</th>
                <th>{t('users.nickname')}</th>
                <th>{t('users.status')}</th>
                <th>{t('users.createdAt')}</th>
                <th>
                  <span className="users-sr">{t('users.actions')}</span>
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
                      {t(STATUS_KEYS[user.status])}
                    </span>
                  </td>
                  <td className="users-when">
                    <time dateTime={dateTimeValue(user.created_at)}>
                      {formatDate(user.created_at, locale)}
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
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const formId = useId();
  const clean = username.trim();

  return (
    <Modal
      title={t('users.newUser')}
      onDismiss={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('users.cancel')}
          </button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || !clean || !name.trim()}
          >
            {busy ? t('users.creating') : t('users.create')}
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
              <span>{t('users.username')}</span>
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
        <FormItem label={t('users.nickname')}>
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
  const { t } = useI18n();
  const toast = useToast();
  const invite = issued.purpose === 'invite';

  const copy = () => {
    navigator.clipboard.writeText(issued.url).then(
      () => toast.success(t('users.linkCopied')),
      () => toast.error(t('users.copyFailed')),
    );
  };

  return (
    <Modal
      title={invite ? t('users.inviteLink') : t('users.resetLink')}
      onDismiss={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('users.done')}
        </Button>
      }
    >
      <p className="users-text">
        {invite ? t('users.inviteHint') : t('users.resetHint')}
      </p>
      <div className="users-link">
        <input
          readOnly
          value={issued.url}
          aria-label={t('users.oneTimeLink')}
          onFocus={event => event.target.select()}
        />
        <Button
          variant="icon"
          aria-label={t('users.copyLink')}
          title={t('users.copyLink')}
          onClick={copy}
        >
          <RiFileCopyLine size={20} aria-hidden />
        </Button>
      </div>
    </Modal>
  );
}
