import { useCallback, useEffect, useState } from 'react';

import { apiFetch } from '../api';
import { useToast } from '../components/toast';

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

// 服务端错误码 → 界面文案
const USER_ERRORS: Record<string, string> = {
  'username taken': '该用户名已被占用',
  'invalid username': '用户名不能为空，且不能包含 @',
  'name is empty': '昵称不能为空',
  'invalid status': '状态无效',
  'user has not activated': '该用户尚未设置密码',
  'cannot modify yourself': '不能修改自己的账号',
  'cannot delete yourself': '不能删除自己的账号',
  'mail domain is not configured': '邮件域名未配置',
};

/**
 * 用户管理：列表、新建、启用停用、删除与一次性链接。
 */
export function useUsers() {
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
    toast.error(
      (data.error && USER_ERRORS[data.error]) ?? `操作失败（${status}）`,
    );
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
        toast.error('操作失败，请重试');

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
        toast.error('操作失败，请重试');

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
        toast.error('操作失败，请重试');

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
        toast.error('操作失败，请重试');

        return null;
      });
  };

  return { users, busy, create, setStatus, remove, issueLink };
}
