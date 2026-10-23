import { RiFileTextLine, RiLogoutBoxRLine, RiMailLine } from '@remixicon/react';
import { useRef } from 'react';

import { Avatar } from '#/client/components/avatar';
import { Popover } from '#/client/components/popover';
import { displayName } from '#/client/format';
import { useI18n } from '#/client/i18n';

import './style.css';

export interface AccountMenuProps {
  id: string;
  user: { name: string; email: string };
  onImportEmail: (files: File[]) => void;
  onImportTemplate: (files: File[]) => void;
  onLogout: () => void;
}

/**
 * 账户入口由头像按钮与全局操作弹层组成。
 */
export function AccountMenu({
  id,
  user,
  onImportEmail,
  onImportTemplate,
  onLogout,
}: AccountMenuProps) {
  const { t } = useI18n();
  const emailRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const accountName = displayName(user);

  return (
    <>
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
          onClick={() => emailRef.current?.click()}
          popoverTarget={id}
          popoverTargetAction="hide"
        >
          <RiMailLine size={20} aria-hidden />
          <span>{t('ui.importEmail')}</span>
        </button>
        <button
          type="button"
          className="popover-item"
          onClick={() => templateRef.current?.click()}
          popoverTarget={id}
          popoverTargetAction="hide"
        >
          <RiFileTextLine size={20} aria-hidden />
          <span>{t('templates.importTemplate')}</span>
        </button>
        <button
          type="button"
          className="popover-item danger"
          onClick={onLogout}
        >
          <RiLogoutBoxRLine size={20} aria-hidden />
          <span>{t('ui.logout')}</span>
        </button>
      </Popover>
      <input
        ref={emailRef}
        type="file"
        accept=".eml,message/rfc822"
        multiple
        hidden
        onChange={event => {
          const files = Array.from(event.target.files ?? []);

          // 清空 value，同一批文件可以再次选择
          event.target.value = '';

          if (files.length > 0) {
            onImportEmail(files);
          }
        }}
      />
      <input
        ref={templateRef}
        type="file"
        accept=".inky"
        multiple
        hidden
        onChange={event => {
          const files = Array.from(event.target.files ?? []);

          event.target.value = '';

          if (files.length > 0) {
            onImportTemplate(files);
          }
        }}
      />
    </>
  );
}
