import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../api';
import { useToast } from '../components/toast';
import { type MessageKey, useI18n } from '../i18n';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'user';
  status: 'invited' | 'active' | 'disabled';
  created_at: string;
}

export interface IssuedLink {
  url: string;
  purpose: 'invite' | 'reset';
}

// 服务端错误码 → 文案键
const USER_ERRORS: Record<string, MessageKey> = {
  'username taken': 'users.errorUsernameTaken',
  'invalid username': 'users.errorInvalidUsername',
  'name is empty': 'users.errorNameEmpty',
  'invalid status': 'users.errorInvalidStatus',
  'user has not activated': 'users.errorNotActivated',
  'cannot modify yourself': 'users.errorCannotModifySelf',
  'cannot delete yourself': 'users.errorCannotDeleteSelf',
  'mail domain is not configured': 'users.errorMailDomain',
};

/**
 * 用户管理：列表、新建、启用停用、删除与一次性链接。
 */
export function useUsers() {
  const { t } = useI18n();
  const toast = useToast();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    apiFetch('/api/users')
      .then(res => res.json<UserSummary[]>())
      .then(data => setUsers(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const report = (data: { error?: string }, status: number) => {
    const key = data.error ? USER_ERRORS[data.error] : undefined;

    toast.error(key ? t(key) : t('users.actionFailed', { status }));
  };

  const create = (username: string, name: string) => {
    setBusy(true);

    return apiFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name }),
    })
      .then(async res => {
        setBusy(false);

        const data = (await res.json()) as { link?: string; error?: string };

        if (!res.ok || !data.link) {
          report(data, res.status);

          return null;
        }
        refresh();

        return { url: data.link, purpose: 'invite' } as IssuedLink;
      })
      .catch(() => {
        setBusy(false);
        toast.error(t('users.actionFailedRetry'));

        return null;
      });
  };

  const setStatus = (id: string, status: 'active' | 'disabled') => {
    setBusy(true);

    return apiFetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then(async res => {
        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
          );

          return false;
        }
        refresh();

        return true;
      })
      .catch(() => {
        toast.error(t('users.actionFailedRetry'));

        return false;
      });
  };

  const remove = (id: string) => {
    return apiFetch(`/api/users/${id}`, { method: 'DELETE' })
      .then(async res => {
        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
          );

          return false;
        }
        refresh();

        return true;
      })
      .catch(() => {
        toast.error(t('users.actionFailedRetry'));

        return false;
      });
  };

  const issueLink = (id: string) => {
    return apiFetch(`/api/users/${id}/link`, { method: 'POST' })
      .then(async res => {
        setBusy(false);

        const data = (await res.json().catch(() => ({}))) as {
          link?: string;
          purpose?: 'invite' | 'reset';
          error?: string;
        };

        if (!res.ok || !data.link) {
          report(data, res.status);

          return null;
        }
        return {
          url: data.link,
          purpose: data.purpose ?? 'reset',
        } as IssuedLink;
      })
      .catch(() => {
        toast.error(t('users.actionFailedRetry'));

        return null;
      });
  };

  return { users, busy, create, setStatus, remove, issueLink };
}
