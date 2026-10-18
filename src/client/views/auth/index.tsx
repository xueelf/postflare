import { RiCheckLine, RiCloseLine, RiLoader4Line } from '@remixicon/react';
import { type FormEvent, useState } from 'react';

import type { DomainStatus } from '../../../worker/domains';
import { DialogHead } from '../../components/dialog-head';
import { FormHelp, FormItem } from '../../components/form-item';
import { Modal } from '../../components/modal';
import { Notice } from '../../components/notice';

import './style.css';

import { Button } from '../../components/button';

import { ConfirmPasswordField } from './confirm-password';
import { AuthShell } from './shell';

const HELP_TITLES = {
  username: '用户名',
  forgot: '忘记密码',
  domain: '邮件域名',
} as const;

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState('zh-CN');
  const [name, setName] = useState('');
  const [help, setHelp] = useState<'username' | 'forgot' | 'domain' | null>(
    null,
  );

  // 昵称自动建议用户名；留空时用建议值
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
      ? '收信服务与发信服务未正确配置'
      : !domain.receiving
        ? '收信服务未正确配置'
        : !domain.sending
          ? '发信服务未正确配置'
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
    <AuthShell>
      {setupComplete ? (
        <form
          className="auth-card"
          onSubmit={event => {
            event.preventDefault();
            onSubmit({ username: username.trim(), password });
          }}
        >
          <DialogHead title="登录" />
          <div className="auth-card-body">
            <FormItem
              label={
                <span className="form-label-main">
                  用户名
                  <FormHelp
                    label="用户名说明"
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
            <FormItem label="密码">
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
              忘记密码？
            </button>
            <Button
              type="submit"
              variant="primary"
              className="auth-submit"
              disabled={busy}
            >
              {busy ? '提交中…' : '登录'}
            </Button>
          </div>
        </form>
      ) : (
        <form className="auth-card" onSubmit={createAccount}>
          <DialogHead title="创建账号" />
          <div className="auth-card-body">
            <FormItem label="界面语言">
              <select
                value={language}
                onChange={event => setLanguage(event.target.value)}
              >
                <option value="zh-CN">简体中文</option>
              </select>
            </FormItem>
            <FormItem
              label={
                <span className="form-label-main">
                  邮件域名
                  <FormHelp
                    label="邮件域名说明"
                    onClick={() => setHelp('domain')}
                  />
                </span>
              }
            >
              {domainError ? (
                <Notice role="alert" className="auth-notice-slot">
                  <strong>无法检查域名状态</strong>
                  <span>{domainError}</span>
                </Notice>
              ) : !mailDomain ? (
                <Notice className="auth-notice-slot">
                  <strong>尚未配置邮件域名</strong>
                  <span>
                    在 Cloudflare 的部署表单里填写 MAIL_DOMAIN，本地开发写入
                    .dev.vars：
                  </span>
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
                          ? '正在检查域名状态'
                          : domainReady
                            ? '收信服务和发信服务已正确配置'
                            : '收信服务或发信服务未正确配置'
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
            <FormItem label="昵称">
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
                  <span>用户名</span>
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
            <FormItem label="密码">
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
              {busy ? '提交中…' : '创建账号'}
            </Button>
          </div>
        </form>
      )}
      {help && (
        <Modal title={HELP_TITLES[help]} onDismiss={() => setHelp(null)}>
          <div className="auth-help">
            {help === 'username' && (
              <>
                <p>
                  用户名是邮箱地址 @ 前面的部分，例如 me@example.com 的用户名是
                  me。
                </p>
                <p>
                  可在「设置 &gt;
                  用户名」处进行修改，修改后邮箱地址随之变化，旧地址不再收信。
                </p>
              </>
            )}
            {help === 'forgot' && (
              <p>
                忘记密码无法自助找回，请联系管理员生成重置密码链接，打开后即可设置新密码。
              </p>
            )}
            {help === 'domain' && (
              <>
                <p>
                  邮件域名来自部署时配置的 MAIL_DOMAIN，固定作为账号地址的域名。
                </p>
                <code className="auth-snippet">MAIL_DOMAIN="example.com"</code>
                <p>
                  收信服务：在 Cloudflare 启用 Email Routing，并把 catch-all
                  规则指向本 Worker。
                </p>
                <p>
                  发信服务：在 Cloudflare Email Service 完成 Onboard
                  Domain，需要 Workers 付费计划。
                </p>
                <p>
                  两项服务按 MX 判断：根域的 MX 指向 Email Routing，cf-bounce
                  子域的 MX 指向 Email Service。
                </p>
              </>
            )}
          </div>
        </Modal>
      )}
    </AuthShell>
  );
}
