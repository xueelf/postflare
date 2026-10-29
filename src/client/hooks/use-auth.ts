import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import {
  advanceAuthEpoch,
  apiFetch,
  setUnauthorizedHandler,
} from '#/client/api';
import { useToast } from '#/client/components/toast';
import {
  type MessageKey,
  type MessageParams,
  initialLocale,
  matchLocale,
  translate,
} from '#/client/i18n';
import type { DomainStatus } from '#/worker/domains';

export interface AuthState {
  setupComplete: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    language: string;
    role: 'owner' | 'user';
  } | null;
  mailDomain: string;
}

export interface InviteValues {
  username?: string;
  name?: string;
  password: string;
  language?: string;
}

// 服务端错误码 → 文案键
const AUTH_ERRORS: Record<string, MessageKey> = {
  'username taken': 'auth.errorUsernameTaken',
  'invalid username': 'auth.errorInvalidUsername',
  'name is empty': 'auth.errorNameEmpty',
  'name is too long': 'auth.errorNameTooLong',
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
  const [logoutBusy, setLogoutBusy] = useState(false);
  const authRef = useRef(auth);
  const authUserIdRef = useRef<string | null>(null);
  const logoutBusyRef = useRef(false);
  const authCommandRef = useRef<Promise<unknown>>(Promise.resolve());

  authRef.current = auth;

  // 会改变认证或 Cookie 的命令串行执行，登出始终排在前序认证命令之后
  const runAuthCommand = <T>(command: () => Promise<T>): Promise<T> => {
    const run = authCommandRef.current.then(command, command);

    authCommandRef.current = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  };

  const commitAuth = (next: AuthState | null) => {
    const nextUserId = next?.user?.id ?? null;

    if (authUserIdRef.current !== nextUserId) {
      authUserIdRef.current = nextUserId;
      advanceAuthEpoch();
    }
    setAuth(next);
  };

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
      .then(data => commitAuth(data))
      .catch(() => setAuthError(true));
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    setProfileBusy(false);
  }, [auth?.user?.id]);

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

  // 当前认证代次收到 401 时清掉本地会话，回到登录界面
  useEffect(() => {
    setUnauthorizedHandler(() => {
      authUserIdRef.current = null;
      advanceAuthEpoch();
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
    if (!auth || logoutBusyRef.current) {
      return;
    }

    setAuthBusy(true);

    const isSetup = !auth.setupComplete;

    runAuthCommand(async () => {
      try {
        const res = await fetch(
          isSetup ? '/api/auth/setup' : '/api/auth/login',
          {
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
          },
        );

        if (!res.ok) {
          const data = (await res.json()) as { error?: string };

          report(data, res.status, 'auth.requestFailed');

          return;
        }
        const data = (await res.json()) as {
          user: AuthState['user'];
          mailDomain: string;
        };

        commitAuth({
          setupComplete: true,
          user: data.user,
          mailDomain: data.mailDomain,
        });
      } catch {
        toast.error(t('auth.networkError'));
      } finally {
        setAuthBusy(false);
      }
    });
  };

  const logout = async (): Promise<boolean> => {
    if (logoutBusyRef.current) {
      return false;
    }

    logoutBusyRef.current = true;
    setLogoutBusy(true);

    try {
      return await runAuthCommand(async () => {
        try {
          const res = await apiFetch('/api/auth/logout', { method: 'POST' });

          if (!res.ok) {
            toast.error(t('app.logoutFailed'));

            return false;
          }
          commitAuth(
            authRef.current ? { ...authRef.current, user: null } : null,
          );
          navigate('/login', { replace: true });

          return true;
        } catch {
          toast.error(t('app.logoutFailed'));

          return false;
        }
      });
    } finally {
      logoutBusyRef.current = false;
      setLogoutBusy(false);
    }
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
    const requestUserId = authRef.current?.user?.id;

    if (!requestUserId) {
      return Promise.resolve(false);
    }
    setProfileBusy(true);

    return apiFetch('/api/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then(async res => {
        if (authRef.current?.user?.id !== requestUserId) {
          return false;
        }
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
          current?.user?.id === requestUserId
            ? { ...current, user: data.user }
            : current,
        );
        toast.success(t('auth.saved'));

        return true;
      })
      .catch(() => {
        if (authRef.current?.user?.id !== requestUserId) {
          return false;
        }
        setProfileBusy(false);
        toast.error(t('auth.saveFailedRetry'));

        return false;
      });
  };

  // 一次性链接：设置密码后自动登录
  const completeInvite = (token: string, values: InviteValues) => {
    if (logoutBusyRef.current) {
      return Promise.resolve(false);
    }
    setAuthBusy(true);

    return runAuthCommand(async () => {
      try {
        const res = await fetch(`/api/invite/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });

        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
            'auth.passwordSetFailed',
          );

          return false;
        }
        const data = (await res.json()) as { user: AuthState['user'] };

        commitAuth(
          authRef.current ? { ...authRef.current, user: data.user } : null,
        );
        toast.success(t('auth.passwordSet'));
        navigate('/inbox', { replace: true });

        return true;
      } catch {
        toast.error(t('auth.passwordSetFailedRetry'));

        return false;
      } finally {
        setAuthBusy(false);
      }
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
    logoutBusy,
  };
}
