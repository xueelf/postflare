import { useCallback, useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import type { DomainStatus } from '../../worker/domains';
import { apiFetch, setUnauthorizedHandler } from '../api';
import { useToast } from '../components/toast';
import {
  type MessageKey,
  type MessageParams,
  initialLocale,
  matchLocale,
  translate,
} from '../i18n';

export interface AuthState {
  setupComplete: boolean;
  user: {
    email: string;
    name: string;
    language: string;
    role: 'owner' | 'user';
  } | null;
  mailDomain: string;
}

// 服务端错误码 → 文案键
const AUTH_ERRORS: Record<string, MessageKey> = {
  'username taken': 'auth.errorUsernameTaken',
  'invalid username': 'auth.errorInvalidUsername',
  'name is empty': 'auth.errorNameEmpty',
  'invalid language': 'auth.errorInvalidLanguage',
  'invalid credentials': 'auth.errorInvalidCredentials',
  'too many attempts': 'auth.errorTooManyAttempts',
  'account disabled': 'auth.errorAccountDisabled',
  'already initialized': 'auth.errorAlreadyInitialized',
  'mail domain is not configured': 'auth.errorMailDomain',
  'password must be at least 8 characters': 'auth.errorPasswordTooShort',
  'password is too long': 'auth.errorPasswordTooLong',
  'current password is incorrect': 'auth.errorWrongPassword',
  'link is invalid or expired': 'auth.errorLinkExpired',
};

/**
 * 认证状态：初始化与登录、登出、改密，并在 401 时清理会话。
 */
export function useAuth(navigate: NavigateFunction) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState(false);
  const toast = useToast();
  const [authBusy, setAuthBusy] = useState(false);
  const [domain, setDomain] = useState<DomainStatus | null>(null);
  const [domainError, setDomainError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  // 本 Hook 在 LocaleProvider 之上运行，需自行解析语言：账号语言优先，未登录按浏览器语言
  const locale = auth?.user ? matchLocale(auth.user.language) : initialLocale();
  const t = (key: MessageKey, params?: MessageParams) =>
    translate(locale, key, params);

  // 服务端错误码转当前语言，未匹配到的给通用失败提示
  const report = (
    data: { error?: string },
    status: number,
    fallback: MessageKey,
  ) => {
    const key = data.error ? AUTH_ERRORS[data.error] : undefined;

    toast.error(key ? t(key) : t(fallback, { status }));
  };

  const loadAuth = useCallback(() => {
    setAuthError(false);

    fetch('/api/auth')
      .then(res => res.json<AuthState>())
      .then(data => setAuth(data))
      .catch(() => setAuthError(true));
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  // 初始化向导：加载配置域名与就绪状态
  useEffect(() => {
    if (!auth || auth.setupComplete) {
      return;
    }
    fetch('/api/auth/domain')
      .then(async res => {
        if (!res.ok) {
          throw new Error(t('auth.requestFailed', { status: res.status }));
        }
        const data = (await res.json()) as { domain: DomainStatus };

        setDomain(data.domain);
      })
      .catch(() => {
        setDomainError(t('auth.domainCheckRetry'));
      });
  }, [auth]);

  // 请求收到 401 时清掉本地会话，回到登录界面
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuth(current => (current ? { ...current, user: null } : current));
    });

    return () => setUnauthorizedHandler(null);
  }, []);

  const submitAuth = (values: {
    username: string;
    password: string;
    name?: string;
    language?: string;
  }) => {
    if (!auth) {
      return;
    }

    setAuthBusy(true);

    const isSetup = !auth.setupComplete;

    fetch(isSetup ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isSetup
          ? {
              username: values.username,
              name: values.name,
              password: values.password,
              language: values.language,
            }
          : { username: values.username, password: values.password },
      ),
    })
      .then(async res => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };

          report(data, res.status, 'auth.requestFailed');
          setAuthBusy(false);

          return;
        }
        const data = (await res.json()) as {
          user: AuthState['user'];
          mailDomain: string;
        };

        setAuth({
          setupComplete: true,
          user: data.user,
          mailDomain: data.mailDomain,
        });
        setAuthBusy(false);
      })
      .catch(() => {
        toast.error(t('auth.networkError'));
        setAuthBusy(false);
      });
  };

  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .then(() => {
        setAuth(current => (current ? { ...current, user: null } : current));
        navigate('/login', { replace: true });
      })
      .catch(() => {});
  };

  const changePassword = (current: string, next: string) => {
    setPasswordBusy(true);

    return apiFetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, next }),
    })
      .then(async res => {
        setPasswordBusy(false);

        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
            'auth.updateFailed',
          );

          return false;
        }
        toast.success(t('auth.passwordUpdated'));

        return true;
      })
      .catch(() => {
        setPasswordBusy(false);
        toast.error(t('auth.updateFailedRetry'));

        return false;
      });
  };

  // 账号资料按字段更新，服务端错误码转成可读文案
  const updateProfile = (patch: {
    username?: string;
    name?: string;
    language?: string;
  }) => {
    setProfileBusy(true);

    return apiFetch('/api/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(async res => {
        setProfileBusy(false);

        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
            'auth.saveFailed',
          );

          return false;
        }
        const data = (await res.json()) as { user: AuthState['user'] };

        setAuth(current =>
          current ? { ...current, user: data.user } : current,
        );
        toast.success(t('auth.saved'));

        return true;
      })
      .catch(() => {
        setProfileBusy(false);
        toast.error(t('auth.saveFailedRetry'));

        return false;
      });
  };

  // 一次性链接：设置密码后自动登录
  const completeInvite = (token: string, password: string) => {
    setAuthBusy(true);

    return fetch(`/api/invite/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
      .then(async res => {
        setAuthBusy(false);

        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
            'auth.passwordSetFailed',
          );

          return false;
        }
        const data = (await res.json()) as { user: AuthState['user'] };

        setAuth(current =>
          current ? { ...current, user: data.user } : current,
        );
        toast.success(t('auth.passwordSet'));
        navigate('/inbox', { replace: true });

        return true;
      })
      .catch(() => {
        setAuthBusy(false);
        toast.error(t('auth.passwordSetFailedRetry'));

        return false;
      });
  };

  return {
    auth,
    authError,
    reloadAuth: loadAuth,
    authBusy,
    domain,
    domainError,
    submitAuth,
    logout,
    completeInvite,
    passwordBusy,
    changePassword,
    profileBusy,
    updateProfile,
  };
}
