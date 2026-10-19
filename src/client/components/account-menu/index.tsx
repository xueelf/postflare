import { RiFileTextLine, RiLogoutBoxRLine } from '@remixicon/react';

import { Avatar } from '#/client/components/avatar';
import { Popover } from '#/client/components/popover';
import { displayName } from '#/client/format';
import { useI18n } from '#/client/i18n';

import './style.css';

export interface AccountMenuProps {
  id: string;
  user: { name: string; email: string };
  onCreateTemplate: () => void;
  onLogout: () => void;
}

/**
 * 账户入口由头像按钮与全局操作弹层组成。
 */
export function AccountMenu({
  id,
  user,
  onCreateTemplate,
  onLogout,
}: AccountMenuProps) {
  const { t } = useI18n();
  const accountName = displayName(user);

  return (
    <Popover
      id={id}
      triggerClassName="account-avatar"
      triggerLabel={t('ui.accountMenu')}
      triggerTitle={user.email}
      trigger={
        <>
          <Avatar name={accountName} />
          <span className="account-text">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </span>
        </>
      }
    >
      <button
        type="button"
        className="popover-item"
        onClick={onCreateTemplate}
        popoverTarget={id}
        popoverTargetAction="hide"
      >
        <RiFileTextLine size={20} aria-hidden />
        <span>{t('ui.newTemplate')}</span>
      </button>
      <button type="button" className="popover-item danger" onClick={onLogout}>
        <RiLogoutBoxRLine size={20} aria-hidden />
        <span>{t('ui.logout')}</span>
      </button>
    </Popover>
  );
}
