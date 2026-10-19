import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiForbidLine,
  RiGroupLine,
  RiKey2Line,
  RiSearchLine,
} from '@remixicon/react';
import { type ReactNode, useId, useState } from 'react';

import { INVITE_MAX_TTL_SECONDS, INVITE_MAX_USES } from '../../../invites';
import { ActionMenu } from '../../components/action-menu';
import { Button } from '../../components/button';
import { EmptyState } from '../../components/empty-state';
import { FormItem } from '../../components/form-item';
import { Modal } from '../../components/modal';
import { useToast } from '../../components/toast';
import { dateTimeInputValue, dateTimeValue, formatDate } from '../../format';
import type { ConfirmRequest } from '../../hooks/use-confirm';
import {
  type IssuedLink,
  type UserSummary,
  useUsers,
} from '../../hooks/use-users';
import { type MessageKey, useI18n } from '../../i18n';

import './style.css';

const STATUS_KEYS: Record<UserSummary['status'], MessageKey> = {
  active: 'users.statusActive',
  disabled: 'users.statusDisabled',
};

export interface UsersProps {
  askConfirm: (request: ConfirmRequest) => void;
}

/**
 * 用户管理：仅所有者可见，负责邀请、启用停用、删除与重置链接。
 */
export function Users({ askConfirm }: UsersProps) {
  const { locale, t } = useI18n();
  const { users, busy, invite, setStatus, remove, issueLink } = useUsers();
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
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

  // 生成成功后关掉表单弹窗，链接交给结果弹窗展示
  const submitInvite = (options: { expiresAt: string; maxUses: number }) => {
    invite(options).then(issued => {
      if (issued) {
        setInviteOpen(false);
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
          onClick={() => setInviteOpen(true)}
        >
          <RiAddLine size={20} aria-hidden />
          {t('users.inviteUser')}
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

      {inviteOpen && (
        <InviteDialog
          busy={busy}
          onSubmit={submitInvite}
          onDismiss={() => setInviteOpen(false)}
        />
      )}

      {link && <LinkDialog issued={link} onClose={() => setLink(null)} />}
    </section>
  );
}

/**
 * 邀请表单：选有效期与注册人数，提交后生成链接。
 */
function InviteDialog({
  busy,
  onSubmit,
  onDismiss,
}: {
  busy: boolean;
  onSubmit: (options: { expiresAt: string; maxUses: number }) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const formId = useId();
  // 可选范围在打开时定下：最早此刻，最晚 24 小时后
  const [{ min, max }] = useState(() => {
    const now = new Date();
    const limit = new Date(now.getTime() + INVITE_MAX_TTL_SECONDS * 1000);

    return { min: dateTimeInputValue(now), max: dateTimeInputValue(limit) };
  });
  const [expiresAt, setExpiresAt] = useState(max);
  const [maxUses, setMaxUses] = useState('1');

  return (
    <Modal
      title={t('users.inviteUser')}
      onDismiss={onDismiss}
      footer={
        <>
          <button type="button" onClick={onDismiss}>
            {t('users.cancel')}
          </button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || !expiresAt || !maxUses}
          >
            {t('users.generateLink')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={event => {
          event.preventDefault();

          onSubmit({
            expiresAt: new Date(expiresAt).toISOString(),
            maxUses: Number(maxUses),
          });
        }}
      >
        <FormItem label={t('users.maxUses')}>
          <input
            type="number"
            value={maxUses}
            min={1}
            max={INVITE_MAX_USES}
            required
            onChange={event => setMaxUses(event.target.value)}
          />
        </FormItem>
        <FormItem label={t('users.expiresAt')}>
          <input
            type="datetime-local"
            value={expiresAt}
            min={min}
            max={max}
            required
            onChange={event => setExpiresAt(event.target.value)}
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
  const { locale, t } = useI18n();
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
      {invite && issued.expiresAt && issued.maxUses !== undefined && (
        <dl className="users-facts">
          <dt>{t('users.maxUses')}</dt>
          <dd>{new Intl.NumberFormat(locale).format(issued.maxUses)}</dd>
          <dt>{t('users.expiresAt')}</dt>
          <dd>
            <time dateTime={issued.expiresAt}>
              {new Date(issued.expiresAt).toLocaleString(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </time>
          </dd>
        </dl>
      )}
    </Modal>
  );
}
