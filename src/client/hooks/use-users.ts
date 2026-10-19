import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '#/client/api';
import { useToast } from '#/client/components/toast';
import { type MessageKey, useI18n } from '#/client/i18n';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'user';
  status: 'active' | 'disabled';
  created_at: string;
}

export interface IssuedLink {
  url: string;
  purpose: 'invite' | 'reset';
  /** 邀请链接的到期时刻与人数上限，重置链接没有这两项 */
  expiresAt?: string;
  maxUses?: number;
}

// 服务端错误码 → 文案键
const USER_ERRORS: Record<string, MessageKey> = {
  'username taken': 'users.errorUsernameTaken',
  'invalid username': 'users.errorInvalidUsername',
  'name is empty': 'users.errorNameEmpty',
  'invalid status': 'users.errorInvalidStatus',
  'cannot modify yourself': 'users.errorCannotModifySelf',
  'cannot delete yourself': 'users.errorCannotDeleteSelf',
  'mail domain is not configured': 'users.errorMailDomain',
  'invalid invite expiry': 'users.errorInvalidExpiry',
  'invalid invite uses': 'users.errorInvalidUses',
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

  const invite = (options: { expiresAt: string; maxUses: number }) => {
    setBusy(true);

    return apiFetch('/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    })
      .then(async res => {
        setBusy(false);

        const data = (await res.json()) as { link?: string; error?: string };

        if (!res.ok || !data.link) {
          report(data, res.status);

          return null;
        }

        toast.success(t('users.linkCreated'));

        return {
          url: data.link,
          purpose: 'invite',
          expiresAt: options.expiresAt,
          maxUses: options.maxUses,
        } as IssuedLink;
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
        setBusy(false);

        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
          );

          return false;
        }
        toast.success(
          t(status === 'disabled' ? 'users.userDisabled' : 'users.userEnabled'),
        );
        refresh();

        return true;
      })
      .catch(() => {
        setBusy(false);
        toast.error(t('users.actionFailedRetry'));

        return false;
      });
  };

  const remove = (id: string) => {
    setBusy(true);

    return apiFetch(`/api/users/${id}`, { method: 'DELETE' })
      .then(async res => {
        setBusy(false);

        if (!res.ok) {
          report(
            (await res.json().catch(() => ({}))) as { error?: string },
            res.status,
          );

          return false;
        }
        toast.success(t('users.userDeleted'));
        refresh();

        return true;
      })
      .catch(() => {
        setBusy(false);
        toast.error(t('users.actionFailedRetry'));

        return false;
      });
  };

  const issueLink = (id: string) => {
    setBusy(true);

    return apiFetch(`/api/users/${id}/link`, { method: 'POST' })
      .then(async res => {
        setBusy(false);

        const data = (await res.json().catch(() => ({}))) as {
          link?: string;
          error?: string;
        };

        if (!res.ok || !data.link) {
          report(data, res.status);

          return null;
        }
        toast.success(t('users.linkCreated'));

        return { url: data.link, purpose: 'reset' } as IssuedLink;
      })
      .catch(() => {
        setBusy(false);
        toast.error(t('users.actionFailedRetry'));

        return null;
      });
  };

  return { users, busy, invite, setStatus, remove, issueLink };
}
