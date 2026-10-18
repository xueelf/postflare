import { RiArrowRightSLine } from '@remixicon/react';
import { Fragment, useId, useState } from 'react';

import { Button } from '../../components/button';
import { FormItem } from '../../components/form-item';
import { Modal } from '../../components/modal';
import { Notice } from '../../components/notice';
import type { ThemeChoice } from '../../hooks/use-theme';
import { type MessageKey, LOCALE_LABELS, LOCALES, useI18n } from '../../i18n';

import './style.css';

// 设置项：只留在组件内，不进地址
type SettingsItem = 'theme' | 'language' | 'username' | 'nickname' | 'password';

export interface SettingsProps {
  user: { email: string; name: string; language: string };
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
  onClose: () => void;
  profileBusy: boolean;
  passwordBusy: boolean;
  onSaveProfile: (patch: {
    username?: string;
    name?: string;
    language?: string;
  }) => Promise<boolean>;
  onSavePassword: (current: string, next: string) => Promise<boolean>;
}

// 行标签与二级弹窗标题共用一份，保证两者始终一致
const LABEL_KEYS: Record<SettingsItem, MessageKey> = {
  theme: 'settings.theme',
  language: 'settings.language',
  username: 'settings.username',
  nickname: 'settings.nickname',
  password: 'settings.password',
};

const THEME_OPTIONS: Array<{ value: ThemeChoice; labelKey: MessageKey }> = [
  { value: 'system', labelKey: 'settings.themeSystem' },
  { value: 'light', labelKey: 'settings.themeLight' },
  { value: 'dark', labelKey: 'settings.themeDark' },
];

const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = LOCALES.map(
  locale => ({ value: locale, label: LOCALE_LABELS[locale] }),
);

/**
 * 设置：一级列表只作入口，具体修改在各条目的二级弹窗里完成，列表不承载待保存状态，也没有保存按钮。
 */
export function Settings({
  user,
  theme,
  onTheme,
  onClose,
  profileBusy,
  passwordBusy,
  onSaveProfile,
  onSavePassword,
}: SettingsProps) {
  const { t } = useI18n();
  const [item, setItem] = useState<SettingsItem | null>(null);
  const username = user.email.split('@')[0] ?? user.email;
  const closeItem = () => setItem(null);
  const themeOptions = THEME_OPTIONS.map(option => ({
    value: option.value,
    label: t(option.labelKey),
  }));

  return (
    <>
      <Modal title={t('settings.title')} size="page" onDismiss={onClose}>
        <nav className="settings-list" aria-label={t('settings.items')}>
          <div className="settings-group">
            <p className="settings-group-title">{t('settings.general')}</p>
            <SettingsRow
              label={t(LABEL_KEYS.theme)}
              value={labelOf(themeOptions, theme)}
              onClick={() => setItem('theme')}
            />
            <hr />
            <SettingsRow
              label={t(LABEL_KEYS.language)}
              value={labelOf(LANGUAGE_OPTIONS, user.language)}
              onClick={() => setItem('language')}
            />
          </div>
          <div className="settings-group">
            <p className="settings-group-title">{t('settings.account')}</p>
            <SettingsRow
              label={t(LABEL_KEYS.username)}
              value={username}
              onClick={() => setItem('username')}
            />
            <hr />
            <SettingsRow
              label={t(LABEL_KEYS.nickname)}
              value={user.name}
              onClick={() => setItem('nickname')}
            />
            <hr />
            <SettingsRow
              label={t(LABEL_KEYS.password)}
              onClick={() => setItem('password')}
            />
          </div>
        </nav>
      </Modal>

      {item === 'theme' && (
        <ChoiceDialog
          name="settings-theme"
          title={t(LABEL_KEYS.theme)}
          value={theme}
          options={themeOptions}
          onSelect={value => {
            onTheme(value as ThemeChoice);
            closeItem();
          }}
          onClose={closeItem}
        />
      )}

      {item === 'language' && (
        <ChoiceDialog
          name="settings-language"
          title={t(LABEL_KEYS.language)}
          value={user.language}
          options={LANGUAGE_OPTIONS}
          onSelect={value => {
            onSaveProfile({ language: value }).then(() => closeItem());
          }}
          onClose={closeItem}
        />
      )}

      {item === 'username' && (
        <TextDialog
          title={t(LABEL_KEYS.username)}
          label={t(LABEL_KEYS.username)}
          initial={username}
          hint={t('settings.usernameHint')}
          autoComplete="off"
          busy={profileBusy}
          onSave={value => onSaveProfile({ username: value })}
          onClose={closeItem}
        />
      )}

      {item === 'nickname' && (
        <TextDialog
          title={t(LABEL_KEYS.nickname)}
          label={t(LABEL_KEYS.nickname)}
          initial={user.name}
          autoComplete="nickname"
          busy={profileBusy}
          onSave={value => onSaveProfile({ name: value })}
          onClose={closeItem}
        />
      )}

      {item === 'password' && (
        <PasswordDialog
          busy={passwordBusy}
          onSave={onSavePassword}
          onClose={closeItem}
        />
      )}
    </>
  );
}

function labelOf(
  options: Array<{ value: string; label: string }>,
  value: string,
): string {
  return options.find(option => option.value === value)?.label ?? value;
}

function SettingsRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-row" onClick={onClick}>
      <span className="settings-row-label">{label}</span>
      {value && <span className="settings-row-value">{value}</span>}
      <RiArrowRightSLine size={20} aria-hidden />
    </button>
  );
}

/**
 * 选项类设置：点选即生效并关闭，不设保存按钮（同 Android ListPreference）。
 */
function ChoiceDialog({
  name,
  title,
  value,
  options,
  onSelect,
  onClose,
}: {
  name: string;
  title: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onDismiss={onClose}>
      <div className="settings-list">
        {options.map((option, index) => (
          <Fragment key={option.value}>
            {index > 0 && <hr />}
            <label className="settings-choice">
              <input
                type="radio"
                name={name}
                checked={option.value === value}
                onChange={() => onSelect(option.value)}
              />
              {option.label}
            </label>
          </Fragment>
        ))}
      </div>
    </Modal>
  );
}

/**
 * 文本类设置：需要明确提交（同 Android EditTextPreference）。
 */
function TextDialog({
  title,
  label,
  initial,
  hint,
  autoComplete,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  hint?: string;
  autoComplete: string;
  busy: boolean;
  onSave: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const formId = useId();

  return (
    <Modal
      title={title}
      onDismiss={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('settings.cancel')}
          </button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || !value.trim()}
          >
            {busy ? t('settings.saving') : t('settings.save')}
          </Button>
        </>
      }
    >
      {hint && <Notice className="settings-tip">{hint}</Notice>}
      <form
        id={formId}
        onSubmit={event => {
          event.preventDefault();

          onSave(value.trim()).then(saved => {
            if (saved) {
              onClose();
            }
          });
        }}
      >
        <FormItem label={label}>
          <input
            value={value}
            required
            autoComplete={autoComplete}
            onChange={event => setValue(event.target.value)}
          />
        </FormItem>
      </form>
    </Modal>
  );
}

/**
 * 密码：当前密码 + 新密码，需要明确提交。
 */
function PasswordDialog({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean;
  onSave: (current: string, next: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const formId = useId();

  return (
    <Modal
      title={t(LABEL_KEYS.password)}
      onDismiss={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {t('settings.cancel')}
          </button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || !current || !next}
          >
            {busy ? t('settings.saving') : t('settings.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={event => {
          event.preventDefault();

          onSave(current, next).then(saved => {
            if (saved) {
              onClose();
            }
          });
        }}
      >
        <FormItem label={t('settings.currentPassword')}>
          <input
            type="password"
            value={current}
            required
            autoComplete="current-password"
            onChange={event => setCurrent(event.target.value)}
          />
        </FormItem>
        <FormItem label={t('settings.newPassword')}>
          <input
            type="password"
            value={next}
            required
            minLength={8}
            autoComplete="new-password"
            onChange={event => setNext(event.target.value)}
          />
        </FormItem>
      </form>
    </Modal>
  );
}
