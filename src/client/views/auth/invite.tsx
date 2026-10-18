import { type FormEvent, useEffect, useState } from 'react';

import { Button } from '../../components/button';
import { DialogHead } from '../../components/dialog-head';
import { FormItem } from '../../components/form-item';
import { Notice } from '../../components/notice';

import { ConfirmPasswordField } from './confirm-password';
import { AuthShell } from './shell';

import './style.css';

interface InviteInfo {
  email: string;
  name: string;
  purpose: 'invite' | 'reset';
}

export interface InviteProps {
  token: string;
  busy: boolean;
  onSubmit: (token: string, password: string) => Promise<boolean>;
}

/**
 * 一次性链接：凭链接设置密码，成功后自动登录。
 */
export function Invite({ token, busy, onSubmit }: InviteProps) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(async res => {
        if (!res.ok) {
          setError('链接无效或已过期');

          return;
        }
        setInfo((await res.json()) as InviteInfo);
      })
      .catch(() => setError('无法校验链接，请重试'));
  }, [token]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(token, password);
  };

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit}>
        <DialogHead
          title={info?.purpose === 'reset' ? '重置密码' : '设置密码'}
        />
        <div className="auth-card-body">
          {error ? (
            <Notice role="alert" className="auth-notice-slot">
              <strong>{error}</strong>
              <span>请让管理员重新生成链接。</span>
            </Notice>
          ) : !info ? (
            <p className="meta">加载中…</p>
          ) : (
            <>
              <FormItem label="账号">
                <div className="auth-domain-row">
                  <span className="auth-domain-name">{info.email}</span>
                </div>
              </FormItem>
              <FormItem label="新密码">
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
                disabled={busy}
              >
                {busy ? '提交中…' : '设置密码'}
              </Button>
            </>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
