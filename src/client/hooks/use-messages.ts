import { useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import { apiFetch } from '../api';
import { type MailRoute, type View, MAILBOX_VIEWS, viewPath } from '../route';

import type { ConfirmRequest } from './use-confirm';
import { useDebouncedValue } from './use-debounced';

export interface MessageSummary {
  id: string;
  mailbox: string;
  direction: 'inbound' | 'outbound';
  seen: number;
  from_address: string;
  from_name: string;
  to_address: string;
  subject: string;
  created_at: string;
  updated_at: string;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}

export interface MessageDetail extends MessageSummary {
  body_text: string | null;
  body_html: string | null;
  attachments: AttachmentInfo[];
}

/**
 * 邮件列表与阅读：搜索、打开邮件、移动/彻底删除/清空与未读计数。
 */
export function useMessages(
  route: MailRoute,
  navigate: NavigateFunction,
  ready: boolean,
  askConfirm: (request: ConfirmRequest) => void,
) {
  const [search, setSearch] = useState(route.q);
  const query = useDebouncedValue(search.trim(), 300);
  const [listVersion, setListVersion] = useState(0);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [counts, setCounts] = useState({
    unread: 0,
    drafts: 0,
    spam_unread: 0,
  });
  const [openMessage, setOpenMessage] = useState<MessageDetail | null>(null);

  const refreshCounts = () =>
    apiFetch('/api/counts')
      .then(res =>
        res.json<{ unread: number; drafts: number; spam_unread: number }>(),
      )
      .then(data => setCounts(data))
      .catch(() => {});

  const refreshList = () => setListVersion(current => current + 1);

  useEffect(() => {
    if (!ready) {
      return;
    }
    refreshCounts();
  }, [ready]);

  // 输入框随 URL 同步（视图切换时清空，后退前进时回填）
  useEffect(() => {
    setSearch(route.q);
  }, [route.q, route.view]);

  // 防抖后的搜索词提交到 URL，不堆历史
  useEffect(() => {
    if (query !== route.q) {
      navigate(viewPath(route.view, route.messageId, query), {
        replace: true,
      });
    }
  }, [query, route.view, route.messageId, route.q]);

  // 列表；请求作废由 AbortController 负责，避免旧响应覆盖新视图
  useEffect(() => {
    if (!ready || !MAILBOX_VIEWS.includes(route.view)) {
      return;
    }

    const controller = new AbortController();
    const suffix = route.q ? `&q=${encodeURIComponent(route.q)}` : '';

    apiFetch(`/api/messages?mailbox=${route.view}${suffix}`, {
      signal: controller.signal,
    })
      .then(res => res.json<MessageSummary[]>())
      .then(data => setMessages(data))
      .catch(() => {});

    return () => controller.abort();
  }, [ready, route.view, route.q, listVersion]);

  // 打开的邮件由路由驱动；确认邮件存在且属于当前视图后再标记已读
  useEffect(() => {
    if (!ready) {
      return;
    }

    const { view, messageId } = route;

    if (!MAILBOX_VIEWS.includes(view) || !messageId) {
      setOpenMessage(null);

      return;
    }

    const controller = new AbortController();

    apiFetch(`/api/messages/${messageId}`, { signal: controller.signal })
      .then(async res => {
        if (res.status === 404) {
          navigate(viewPath(view, null, route.q), { replace: true });

          return null;
        }
        return res.ok ? ((await res.json()) as MessageDetail) : null;
      })
      .then(data => {
        if (!data) {
          return;
        }

        if (data.mailbox !== view) {
          navigate(viewPath(data.mailbox as View, data.id, route.q), {
            replace: true,
          });

          return;
        }
        setOpenMessage(data);

        if ((view === 'inbox' || view === 'spam') && data.seen === 0) {
          apiFetch(`/api/messages/${messageId}/read`, { method: 'POST' })
            .then(res => {
              // fetch 不会因 HTTP 错误 reject，失败时不改本地状态与计数
              if (!res.ok) {
                return;
              }
              setMessages(current =>
                current.map(message =>
                  message.id === messageId ? { ...message, seen: 1 } : message,
                ),
              );
              refreshCounts();
            })
            .catch(() => {});
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [ready, route.view, route.messageId]);

  // 删除或移走后自动选中下一条，没有下一条则上一条
  const neighborId = (id: string) => {
    const index = messages.findIndex(message => message.id === id);

    if (index === -1) {
      return null;
    }
    return messages[index + 1]?.id ?? messages[index - 1]?.id ?? null;
  };

  const discardDraft = (id: string) => {
    askConfirm({
      title: '丢弃这份草稿？',
      message: '丢弃后无法恢复。',
      confirmText: '丢弃',
      danger: true,
      action: () => {
        const next = neighborId(id);

        apiFetch(`/api/drafts/${id}`, { method: 'DELETE' })
          .then(() => {
            refreshList();
            navigate(viewPath('drafts', next, route.q), { replace: true });
          })
          .catch(() => {});
      },
    });
  };

  const moveMessage = (
    id: string,
    mailbox: 'inbox' | 'sent' | 'spam' | 'trash',
  ) => {
    const next = neighborId(id);

    apiFetch(`/api/messages/${id}/mailbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox }),
    })
      .then(() => {
        refreshList();
        navigate(viewPath(route.view, next, route.q), { replace: true });
      })
      .catch(() => {});
  };

  const purgeMessage = (id: string) => {
    askConfirm({
      title: '永久删除这封邮件？',
      message: '回收站中的邮件删除后无法恢复。',
      confirmText: '永久删除',
      danger: true,
      action: () => {
        const next = neighborId(id);

        apiFetch(`/api/messages/${id}`, { method: 'DELETE' })
          .then(() => {
            refreshList();
            navigate(viewPath(route.view, next, route.q), { replace: true });
          })
          .catch(() => {});
      },
    });
  };

  const emptyMailbox = (mailbox: 'spam' | 'trash') => {
    const label = mailbox === 'spam' ? '垃圾邮件' : '回收站';

    askConfirm({
      title: `清空${label}？`,
      message: '其中的邮件将被永久删除。',
      confirmText: '清空',
      danger: true,
      action: () => {
        apiFetch(`/api/messages?mailbox=${mailbox}`, { method: 'DELETE' })
          .then(() => {
            refreshList();

            if (route.messageId) {
              navigate(viewPath(route.view, null, route.q), {
                replace: true,
              });
            }
          })
          .catch(() => {});
      },
    });
  };

  return {
    search,
    setSearch,
    messages,
    counts,
    openMessage,
    refreshList,
    discardDraft,
    moveMessage,
    purgeMessage,
    emptyMailbox,
  };
}
