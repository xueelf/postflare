import { type FormEvent, useEffect, useState } from 'react';

import { Button } from '#/client/components/button';
import { DialogHead } from '#/client/components/dialog-head';
import { FormItem } from '#/client/components/form-item';
import { Notice } from '#/client/components/notice';
import type { InviteValues } from '#/client/hooks/use-auth';
import { useI18n } from '#/client/i18n';

import { ConfirmPasswordField } from './confirm-password';
import { AuthShell } from './shell';

import './style.css';

interface InviteInfo {
  purpose: 'invite' | 'reset';
  domain?: string;
  email?: string;
  name?: string;
}

export interface InviteProps {
  token: string;
  busy: boolean;
  onSubmit: (token: string, values: InviteValues) => Promise<boolean>;
}

/**
 * 一次性链接：邀请由对方自己选用户名与昵称，重置只换密码，成功后自动登录。
 */
export function Invite({ token, busy, onSubmit }: InviteProps) {
  const { locale, t } = useI18n();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(async res => {
        if (!res.ok) {
          setError(t('auth.errorLinkExpired'));

          return;
        }
        setInfo((await res.json()) as InviteInfo);
      })
      .catch(() => setError(t('auth.linkCheckFailed')));
  }, [token, t]);

  const invite = info?.purpose === 'invite';
  const clean = username.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();

    onSubmit(
      token,
      invite
        ? { username: clean, name: name.trim(), password, language: locale }
        : { password },
    );
  };

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit}>
        <DialogHead
          title={invite ? t('auth.createAccount') : t('auth.resetPassword')}
        />
        <div className="auth-card-body">
          {error ? (
            <Notice role="alert">
              <strong>{error}</strong>
              <span>{t('auth.linkExpiredHint')}</span>
            </Notice>
          ) : !info ? (
            <p className="meta">{t('common.loading')}</p>
          ) : (
            <>
              {invite ? (
                <>
                  <FormItem
                    label={
                      <>
                        <span>{t('auth.username')}</span>
                        {clean && (
                          <span className="form-ref">
                            {clean}@{info.domain}
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
                  <FormItem label={t('auth.name')}>
                    <input
                      value={name}
                      required
                      autoComplete="nickname"
                      onChange={event => setName(event.target.value)}
                    />
                  </FormItem>
                </>
              ) : (
                <FormItem label={t('auth.account')}>
                  <div className="auth-domain-row">
                    <span className="auth-domain-name">{info.email}</span>
                  </div>
                </FormItem>
              )}
              <FormItem
                label={invite ? t('auth.password') : t('auth.newPassword')}
              >
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
                disabled={busy || (invite && (!clean || !name.trim()))}
              >
                {busy
                  ? t('auth.submitting')
                  : invite
                    ? t('auth.createAccount')
                    : t('auth.setPassword')}
              </Button>
            </>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
