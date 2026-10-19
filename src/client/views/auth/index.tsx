import { RiCheckLine, RiCloseLine, RiLoader4Line } from '@remixicon/react';
import { type FormEvent, useState } from 'react';

import type { DomainStatus } from '../../../worker/domains';
import { DialogHead } from '../../components/dialog-head';
import { FormHelp, FormItem } from '../../components/form-item';
import { Modal } from '../../components/modal';
import { Notice } from '../../components/notice';
import {
  type Locale,
  type MessageKey,
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LocaleProvider,
  LOCALES,
  translate,
  useI18n,
} from '../../i18n';

import './style.css';

import { Button } from '../../components/button';

import { ConfirmPasswordField } from './confirm-password';
import { AuthShell } from './shell';

type HelpTopic = 'username' | 'forgot' | 'domain';

// 帮助弹窗标题与对应字段标签复用同一键
const HELP_TITLES: Record<HelpTopic, MessageKey> = {
  username: 'auth.username',
  forgot: 'auth.forgotPasswordTitle',
  domain: 'auth.mailDomain',
};

export interface AuthProps {
  setupComplete: boolean;
  mailDomain: string;
  domain: DomainStatus | null;
  domainError: string;
  busy: boolean;
  onSubmit: (values: {
    username: string;
    password: string;
    name?: string;
    language?: string;
  }) => void;
}

/**
 * 登录与初始化：首次使用创建管理员账号，之后登录。
 */
export function Auth({
  setupComplete,
  mailDomain,
  domain,
  domainError,
  busy,
  onSubmit,
}: AuthProps) {
  const { locale } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<Locale>(DEFAULT_LOCALE);
  const [name, setName] = useState('');
  const [help, setHelp] = useState<HelpTopic | null>(null);

  // 向导内以所选语言渲染，登录界面跟随全局语言
  const uiLocale = setupComplete ? locale : language;
  const t = (key: MessageKey) => translate(uiLocale, key);

  // 昵称自动建议用户名，留空时用建议值
  const suggestion =
    name
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') ?? '';
  const cleanUsername =
    username.trim().toLowerCase().replace(/@.*$/, '') || suggestion;
  const domainReady = Boolean(domain?.receiving && domain?.sending);
  // 校验失败只给一行状态，配置细节放在问号弹窗里
  const domainIssue = !domain
    ? ''
    : !domain.receiving && !domain.sending
      ? t('auth.receivingSendingIssue')
      : !domain.receiving
        ? t('auth.receivingIssue')
        : !domain.sending
          ? t('auth.sendingIssue')
          : '';

  const createAccount = (event: FormEvent) => {
    event.preventDefault();

    onSubmit({
      username: cleanUsername,
      password,
      name: name.trim(),
      language,
    });
  };

  return (
    <LocaleProvider locale={uiLocale}>
      <AuthShell>
        {setupComplete ? (
          <form
            className="auth-card"
            onSubmit={event => {
              event.preventDefault();
              onSubmit({ username: username.trim(), password });
            }}
          >
            <DialogHead title={t('auth.signIn')} />
            <div className="auth-card-body">
              <FormItem
                label={
                  <span className="form-label-main">
                    {t('auth.username')}
                    <FormHelp
                      label={t('auth.usernameHelp')}
                      onClick={() => setHelp('username')}
                    />
                  </span>
                }
              >
                <input
                  value={username}
                  required
                  autoComplete="username"
                  onChange={event => setUsername(event.target.value)}
                />
              </FormItem>
              <FormItem label={t('auth.password')}>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  onChange={event => setPassword(event.target.value)}
                />
              </FormItem>
              <button
                type="button"
                className="auth-forgot"
                onClick={() => setHelp('forgot')}
              >
                {t('auth.forgotPassword')}
              </button>
              <Button
                type="submit"
                variant="primary"
                className="auth-submit"
                disabled={busy}
              >
                {busy ? t('auth.submitting') : t('auth.signIn')}
              </Button>
            </div>
          </form>
        ) : (
          <form className="auth-card" onSubmit={createAccount}>
            <DialogHead title={t('auth.createAccount')} />
            <div className="auth-card-body">
              <FormItem label={t('auth.interfaceLanguage')}>
                <select
                  value={language}
                  onChange={event => setLanguage(event.target.value as Locale)}
                >
                  {LOCALES.map(option => (
                    <option key={option} value={option}>
                      {LOCALE_LABELS[option]}
                    </option>
                  ))}
                </select>
              </FormItem>
              <FormItem
                label={
                  <span className="form-label-main">
                    {t('auth.mailDomain')}
                    <FormHelp
                      label={t('auth.mailDomainHelp')}
                      onClick={() => setHelp('domain')}
                    />
                  </span>
                }
              >
                {domainError ? (
                  <Notice role="alert">
                    <strong>{t('auth.domainCheckFailed')}</strong>
                    <span>{domainError}</span>
                  </Notice>
                ) : !mailDomain ? (
                  <Notice>
                    <strong>{t('auth.errorMailDomain')}</strong>
                    <span>{t('auth.mailDomainMissingHint')}</span>
                    <code className="auth-snippet">
                      MAIL_DOMAIN="yourdomain.com"
                    </code>
                  </Notice>
                ) : (
                  <>
                    <div className="auth-domain-row">
                      <span className="auth-domain-name">{mailDomain}</span>
                      <span
                        className="auth-status"
                        data-state={
                          domain === null
                            ? 'loading'
                            : domainReady
                              ? 'ok'
                              : 'warn'
                        }
                        role="img"
                        aria-label={
                          domain === null
                            ? t('auth.domainChecking')
                            : domainReady
                              ? t('auth.domainReady')
                              : t('auth.domainNotReady')
                        }
                      >
                        {domain === null ? (
                          <RiLoader4Line
                            className="auth-spinner"
                            size={20}
                            aria-hidden
                          />
                        ) : domainReady ? (
                          <RiCheckLine size={20} aria-hidden />
                        ) : (
                          <RiCloseLine size={20} aria-hidden />
                        )}
                      </span>
                    </div>
                    {domainIssue && <p className="auth-issue">{domainIssue}</p>}
                  </>
                )}
              </FormItem>
              <FormItem label={t('auth.name')}>
                <input
                  value={name}
                  required
                  autoComplete="nickname"
                  onChange={event => setName(event.target.value)}
                />
              </FormItem>
              <FormItem
                label={
                  <>
                    <span>{t('auth.username')}</span>
                    {mailDomain && (
                      <span className="form-ref">
                        {cleanUsername || 'me'}@{mailDomain}
                      </span>
                    )}
                  </>
                }
              >
                <input
                  value={username}
                  required
                  autoComplete="username"
                  placeholder={suggestion || 'me'}
                  onChange={event => setUsername(event.target.value)}
                />
              </FormItem>
              <FormItem label={t('auth.password')}>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  onChange={event => setPassword(event.target.value)}
                />
              </FormItem>
              <ConfirmPasswordField password={password} />
              <Button
                type="submit"
                variant="primary"
                className="auth-submit"
                disabled={busy || !mailDomain}
              >
                {busy ? t('auth.submitting') : t('auth.createAccount')}
              </Button>
            </div>
          </form>
        )}
        {help && (
          <Modal title={t(HELP_TITLES[help])} onDismiss={() => setHelp(null)}>
            <div className="auth-help">
              {help === 'username' && (
                <>
                  <p>{t('auth.usernameIntro')}</p>
                  <p>{t('auth.usernameChangeHint')}</p>
                </>
              )}
              {help === 'forgot' && <p>{t('auth.forgotPasswordBody')}</p>}
              {help === 'domain' && (
                <>
                  <p>{t('auth.mailDomainIntro')}</p>
                  <code className="auth-snippet">
                    MAIL_DOMAIN="example.com"
                  </code>
                  <p>{t('auth.mailDomainReceiving')}</p>
                  <p>{t('auth.mailDomainSending')}</p>
                  <p>{t('auth.mailDomainMx')}</p>
                </>
              )}
            </div>
          </Modal>
        )}
      </AuthShell>
    </LocaleProvider>
  );
}
