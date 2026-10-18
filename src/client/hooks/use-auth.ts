import { useCallback, useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import type { DomainStatus } from '../../worker/domains';
import { apiFetch, setUnauthorizedHandler } from '../api';
import { useToast } from '../components/toast';

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

// 服务端错误码 → 界面文案
const PROFILE_ERRORS: Record<string, string> = {
  'username taken': '该用户名已被占用',
  'invalid username': '用户名不能为空，且不能包含 @',
  'name is empty': '昵称不能为空',
  'invalid language': '界面语言无效',
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
          throw new Error(`请求失败（${res.status}）`);
        }
        const data = (await res.json()) as { domain: DomainStatus };

        setDomain(data.domain);
      })
      .catch(() => {
        setDomainError('无法检查域名状态，请刷新重试');
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

          toast.error(
            !isSetup && res.status === 401
              ? '账号或密码不正确'
              : res.status === 403 && data.error === 'account disabled'
                ? '账号已停用'
                : (data.error ?? `请求失败（${res.status}）`),
          );
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
        toast.error('网络请求失败，请重试');
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
          toast.error(
            res.status === 401 ? '当前密码不正确' : `更新失败（${res.status}）`,
          );

          return false;
        }
        toast.success('密码已更新');

        return true;
      })
      .catch(() => {
        setPasswordBusy(false);
        toast.error('更新失败，请重试');

        return false;
      });
  };

  // 账号资料按字段更新，服务端错误码在这里转成可读文案
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
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };

          toast.error(
            (data.error && PROFILE_ERRORS[data.error]) ??
              `保存失败（${res.status}）`,
          );

          return false;
        }
        const data = (await res.json()) as { user: AuthState['user'] };

        setAuth(current =>
          current ? { ...current, user: data.user } : current,
        );
        toast.success('已保存');

        return true;
      })
      .catch(() => {
        setProfileBusy(false);
        toast.error('保存失败，请重试');

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
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };

          toast.error(
            data.error === 'link is invalid or expired'
              ? '链接无效或已过期'
              : `设置失败（${res.status}）`,
          );

          return false;
        }
        const data = (await res.json()) as { user: AuthState['user'] };

        setAuth(current =>
          current ? { ...current, user: data.user } : current,
        );
        toast.success('密码已设置');
        navigate('/inbox', { replace: true });

        return true;
      })
      .catch(() => {
        setAuthBusy(false);
        toast.error('设置失败，请重试');

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
