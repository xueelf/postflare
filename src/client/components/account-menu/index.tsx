import { RiFileTextLine, RiLogoutBoxRLine } from '@remixicon/react';

import { displayName } from '../../format';
import { useI18n } from '../../i18n';
import { Avatar } from '../avatar';
import { Popover } from '../popover';

import './style.css';

export interface AccountMenuProps {
  id: string;
  user: { name: string; email: string };
  onCreateTemplate: () => void;
  onLogout: () => void;
}

/**
 * 账户入口：头像按钮 + 弹层（全局操作）。
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
