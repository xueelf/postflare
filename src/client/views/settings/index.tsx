import { RiArrowRightSLine } from '@remixicon/react';
import { Fragment, useId, useState } from 'react';

import { Button } from '../../components/button';
import { FormItem } from '../../components/form-item';
import { Modal } from '../../components/modal';
import { Notice } from '../../components/notice';
import type { ThemeChoice } from '../../hooks/use-theme';

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
const LABELS: Record<SettingsItem, string> = {
  theme: '主题',
  language: '界面语言',
  username: '用户名',
  nickname: '昵称',
  password: '密码',
};

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
];

/**
 * 设置：一级列表只作入口，具体修改在各条目的二级弹窗里完成，
 * 所以一级不承载待保存状态，也没有保存按钮。
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
  const [item, setItem] = useState<SettingsItem | null>(null);
  const username = user.email.split('@')[0] ?? user.email;
  const closeItem = () => setItem(null);

  return (
    <>
      <Modal title="设置" size="page" onDismiss={onClose}>
        <nav className="settings-list" aria-label="设置项">
          <div className="settings-group">
            <p className="settings-group-title">通用</p>
            <SettingsRow
              label={LABELS.theme}
              value={labelOf(THEME_OPTIONS, theme)}
              onClick={() => setItem('theme')}
            />
            <hr />
            <SettingsRow
              label={LABELS.language}
              value={labelOf(LANGUAGE_OPTIONS, user.language)}
              onClick={() => setItem('language')}
            />
          </div>
          <div className="settings-group">
            <p className="settings-group-title">账户</p>
            <SettingsRow
              label={LABELS.username}
              value={username}
              onClick={() => setItem('username')}
            />
            <hr />
            <SettingsRow
              label={LABELS.nickname}
              value={user.name}
              onClick={() => setItem('nickname')}
            />
            <hr />
            <SettingsRow
              label={LABELS.password}
              onClick={() => setItem('password')}
            />
          </div>
        </nav>
      </Modal>

      {item === 'theme' && (
        <ChoiceDialog
          name="settings-theme"
          title={LABELS.theme}
          value={theme}
          options={THEME_OPTIONS}
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
          title={LABELS.language}
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
          title={LABELS.username}
          label={LABELS.username}
          initial={username}
          hint="用户名就是邮箱地址 @ 前的部分。修改后邮箱地址随之变化，旧地址不再收信。"
          autoComplete="off"
          busy={profileBusy}
          onSave={value => onSaveProfile({ username: value })}
          onClose={closeItem}
        />
      )}

      {item === 'nickname' && (
        <TextDialog
          title={LABELS.nickname}
          label={LABELS.nickname}
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
  const [value, setValue] = useState(initial);
  const formId = useId();

  return (
    <Modal
      title={title}
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
            disabled={busy || !value.trim()}
          >
            {busy ? '保存中…' : '保存'}
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
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const formId = useId();

  return (
    <Modal
      title={LABELS.password}
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
            disabled={busy || !current || !next}
          >
            {busy ? '保存中…' : '保存'}
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
        <FormItem label="当前密码">
          <input
            type="password"
            value={current}
            required
            autoComplete="current-password"
            onChange={event => setCurrent(event.target.value)}
          />
        </FormItem>
        <FormItem label="新密码">
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
