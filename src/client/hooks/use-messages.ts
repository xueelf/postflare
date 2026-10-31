import { useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import { apiFetch } from '#/client/api';
import { useToast } from '#/client/components/toast';
import { type MessageKey, useI18n } from '#/client/i18n';
import {
  type MailRoute,
  type View,
  MAILBOX_VIEWS,
  viewPath,
} from '#/client/route';
import { MAIL_RETENTION_DAYS } from '#/limits';

import type { ConfirmRequest } from './use-confirm';

// 移动目标 → 成功提示
const MOVE_TOASTS: Record<'inbox' | 'sent' | 'spam' | 'trash', MessageKey> = {
  inbox: 'mail.restoredToInbox',
  sent: 'mail.restoredToSent',
  spam: 'mail.movedToSpam',
  trash: 'mail.movedToTrash',
};

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
  body_source: string | null;
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
  deleteDraft?: (id: string) => Promise<Response | null>,
) {
  const { t } = useI18n();
  const toast = useToast();
  const [search, setSearchState] = useState(route.q);
  const [listRevision, setListRevision] = useState(0);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // 列表、游标和产生它们的查询必须一致
  const listKey = `${route.view}|${route.q}|${listRevision}`;
  const listKeyRef = useRef(listKey);
  const cursorKeyRef = useRef('');
  const loadingMoreRef = useRef(false);
  const [counts, setCounts] = useState({
    unread: 0,
    drafts: 0,
    spam_unread: 0,
  });
  const [openMessage, setOpenMessage] = useState<MessageDetail | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const routeRef = useRef(route);
  const navigateRef = useRef(navigate);
  const detailVersionRef = useRef(0);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchVersionRef = useRef(0);
  const disposedRef = useRef(false);

  routeRef.current = route;
  navigateRef.current = navigate;
  listKeyRef.current = listKey;

  const refreshCounts = () =>
    apiFetch('/api/counts')
      .then(async res => {
        if (!res.ok) {
          if (!disposedRef.current) {
            toast.error(t('common.loadFailed'));
          }

          return;
        }
        const data = await res.json<{
          unread: number;
          drafts: number;
          spam_unread: number;
        }>();

        if (!disposedRef.current) {
          setCounts(data);
        }
      })
      .catch(() => {});

  const refreshList = () => {
    if (!disposedRef.current) {
      setListRevision(current => current + 1);
    }
  };

  // 保存响应直接带回详情，写请求串行完成后按时间顺序落到阅读器
  const syncOpenMessage = (message: MessageDetail) => {
    if (disposedRef.current || routeRef.current.messageId !== message.id) {
      return;
    }
    detailVersionRef.current += 1;
    setOpenMessage(message);
    setMessageLoading(false);
  };

  useEffect(() => {
    if (!ready) {
      return;
    }
    refreshCounts();
  }, [ready]);

  // 输入框随 URL 同步，路由变化时取消尚未提交的搜索
  useEffect(() => {
    searchVersionRef.current += 1;

    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setSearchState(route.q);
  }, [route.q, route.view, route.messageId, route.hash]);

  useEffect(() => {
    return () => {
      disposedRef.current = true;

      if (commitTimerRef.current) {
        clearTimeout(commitTimerRef.current);
      }
    };
  }, []);

  // 只有用户输入才安排防抖提交，提交时保留当前片段和导航状态
  const setSearch = (value: string) => {
    const version = ++searchVersionRef.current;
    const context = routeRef.current;

    setSearchState(value);

    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
    }

    commitTimerRef.current = setTimeout(() => {
      const current = routeRef.current;

      if (
        version !== searchVersionRef.current ||
        current.hash !== context.hash ||
        current.view !== context.view ||
        current.messageId !== context.messageId
      ) {
        return;
      }
      const next = value.trim();

      if (next !== current.q) {
        navigateRef.current(
          `${viewPath(current.view, current.messageId, next)}${current.hash}`,
          { replace: true, state: current.state },
        );
      }
    }, 300);
  };

  // 列表请求由 AbortController 作废，避免旧响应覆盖新视图
  useEffect(() => {
    if (!ready || !MAILBOX_VIEWS.includes(route.view)) {
      return;
    }

    const controller = new AbortController();
    const suffix = route.q ? `&q=${encodeURIComponent(route.q)}` : '';
    const key = listKey;

    // 新查询首页返回前不允许继续使用旧游标
    cursorKeyRef.current = '';
    setNextCursor(null);

    apiFetch(`/api/messages?mailbox=${route.view}${suffix}`, {
      signal: controller.signal,
    })
      .then(async res => {
        if (disposedRef.current || controller.signal.aborted) {
          return;
        }

        if (!res.ok) {
          toast.error(t('common.loadFailed'));

          return;
        }
        const data = await res.json<{
          messages: MessageSummary[];
          next: string | null;
        }>();

        if (disposedRef.current || listKeyRef.current !== key) {
          return;
        }
        setMessages(data.messages);
        setNextCursor(data.next);
        cursorKeyRef.current = key;
      })
      .catch(() => {});

    return () => controller.abort();
  }, [ready, route.view, route.q, listRevision]);

  // 触底加载下一页，视图、搜索词或列表刷新后旧响应直接丢弃
  const loadMore = () => {
    if (
      !nextCursor ||
      loadingMoreRef.current ||
      cursorKeyRef.current !== listKey
    ) {
      return;
    }
    const key = listKey;
    const cursor = nextCursor;
    const suffix = route.q ? `&q=${encodeURIComponent(route.q)}` : '';

    loadingMoreRef.current = true;
    setLoadingMore(true);

    apiFetch(
      `/api/messages?mailbox=${route.view}${suffix}&cursor=${encodeURIComponent(cursor)}`,
    )
      .then(async res => {
        if (disposedRef.current) {
          return;
        }

        if (!res.ok) {
          toast.error(t('common.loadFailed'));

          return;
        }
        const data = await res.json<{
          messages: MessageSummary[];
          next: string | null;
        }>();

        if (
          disposedRef.current ||
          listKeyRef.current !== key ||
          cursorKeyRef.current !== key
        ) {
          return;
        }
        setMessages(current => {
          const seen = new Set(current.map(message => message.id));

          return [
            ...current,
            ...data.messages.filter(message => !seen.has(message.id)),
          ];
        });
        setNextCursor(data.next);
      })
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;

        if (!disposedRef.current) {
          setLoadingMore(false);
        }
      });
  };

  // 打开的邮件由路由驱动，确认存在且属于当前视图后再标记已读
  useEffect(() => {
    if (!ready) {
      return;
    }

    const { view, messageId } = route;

    if (!MAILBOX_VIEWS.includes(view) || !messageId) {
      setOpenMessage(null);
      setMessageLoading(false);

      return;
    }

    const controller = new AbortController();

    let cancelled = false;

    const version = detailVersionRef.current;

    setOpenMessage(null);
    setMessageLoading(true);

    apiFetch(`/api/messages/${messageId}`, { signal: controller.signal })
      .then(async res => {
        if (cancelled || disposedRef.current) {
          return null;
        }

        if (res.status === 404) {
          navigate(viewPath(view, null, route.q), { replace: true });

          return null;
        }
        return res.ok ? ((await res.json()) as MessageDetail) : null;
      })
      .then(data => {
        if (
          cancelled ||
          disposedRef.current ||
          version !== detailVersionRef.current
        ) {
          return;
        }

        if (!data) {
          setMessageLoading(false);

          return;
        }

        if (data.mailbox !== view) {
          navigate(viewPath(data.mailbox as View, data.id, route.q), {
            replace: true,
          });

          return;
        }
        setOpenMessage(data);
        setMessageLoading(false);

        if ((view === 'inbox' || view === 'spam') && data.seen === 0) {
          apiFetch(`/api/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seen: true }),
          })
            .then(res => {
              // fetch 不会因 HTTP 错误 reject，失败时不改本地状态与计数
              if (cancelled || disposedRef.current || !res.ok) {
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
      .catch(() => {
        if (!cancelled && !disposedRef.current) {
          setMessageLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ready, route.view, route.messageId]);

  // 删除或移走后自动选中下一条，没有下一条则上一条
  const neighborId = (id: string) => {
    const index = messages.findIndex(message => message.id === id);

    if (index === -1) {
      return null;
    }
    return messages[index + 1]?.id ?? messages[index - 1]?.id ?? null;
  };

  // 只有用户仍停留在操作发起时的邮件与搜索上下文，才自动选择邻居
  const sameMessageContext = (id: string, context: MailRoute) => {
    const current = routeRef.current;

    return (
      current.messageId === id &&
      current.view === context.view &&
      current.q === context.q
    );
  };

  const discardDraft = (id: string) => {
    askConfirm({
      title: t('mail.discardTitle'),
      message: t('mail.discardMessage'),
      confirmText: t('mail.discard'),
      danger: true,
      action: () => {
        const context = routeRef.current;
        const next = neighborId(id);
        const request = deleteDraft
          ? deleteDraft(id)
          : apiFetch(`/api/drafts/${id}`, { method: 'DELETE' });

        request
          .then(res => {
            if (disposedRef.current) {
              return;
            }

            if (!res) {
              toast.error(t('compose.editingElsewhere'));

              return;
            }

            if (!res.ok) {
              toast.error(t('mail.actionFailedRetry'));

              return;
            }
            toast.success(t('mail.draftDiscarded'));
            refreshList();
            refreshCounts();

            if (sameMessageContext(id, context)) {
              navigate(viewPath('drafts', next, context.q), { replace: true });
            }
          })
          .catch(() => {
            if (!disposedRef.current) {
              toast.error(t('mail.actionFailedRetry'));
            }
          });
      },
    });
  };

  const moveMessage = (
    id: string,
    mailbox: 'inbox' | 'sent' | 'spam' | 'trash',
  ) => {
    const context = routeRef.current;
    const next = neighborId(id);

    apiFetch(`/api/messages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox }),
    })
      .then(res => {
        if (disposedRef.current) {
          return;
        }

        if (!res.ok) {
          toast.error(
            res.status === 410
              ? t('mail.expired', { days: MAIL_RETENTION_DAYS })
              : t('mail.actionFailedRetry'),
          );

          if (res.status === 410) {
            refreshList();
            refreshCounts();
          }

          return;
        }
        toast.success(t(MOVE_TOASTS[mailbox]));
        refreshList();
        refreshCounts();

        if (sameMessageContext(id, context)) {
          navigate(viewPath(context.view, next, context.q), { replace: true });
        }
      })
      .catch(() => {
        if (!disposedRef.current) {
          toast.error(t('mail.actionFailedRetry'));
        }
      });
  };

  const downloadMessage = (id: string) => {
    apiFetch(`/api/messages/${id}/eml`)
      .then(async res => {
        if (disposedRef.current) {
          return;
        }

        if (!res.ok) {
          toast.error(t('mail.actionFailedRetry'));

          return;
        }
        // 文件名以服务端下发的为准，客户端不再拼一遍
        const name =
          /filename\*=UTF-8''([^;]+)/.exec(
            res.headers.get('Content-Disposition') ?? '',
          )?.[1] ?? 'message.eml';
        const url = URL.createObjectURL(await res.blob());

        if (disposedRef.current) {
          URL.revokeObjectURL(url);

          return;
        }
        const link = document.createElement('a');

        link.href = url;
        link.download = decodeURIComponent(name);
        link.click();
        // 等浏览器开始读取后再释放
        setTimeout(() => URL.revokeObjectURL(url));
      })
      .catch(() => {
        if (!disposedRef.current) {
          toast.error(t('mail.actionFailedRetry'));
        }
      });
  };

  const importMessages = (files: File[]) => {
    const form = new FormData();

    for (const file of files) {
      form.append('files', file);
    }

    apiFetch('/api/messages/import', { method: 'POST', body: form })
      .then(async res => {
        if (disposedRef.current) {
          return;
        }

        if (!res.ok) {
          throw new Error('import failed');
        }
        const data = (await res.json()) as {
          imported: number;
          skipped: number;
          failed: number;
        };

        if (disposedRef.current) {
          return;
        }

        if (data.imported === 0) {
          toast.error(t('mail.importFailed'));

          return;
        }

        if (data.failed > 0) {
          toast.info(
            t('mail.importPartial', {
              imported: data.imported,
              failed: data.failed,
            }),
          );
        } else {
          toast.success(t('mail.imported', { count: data.imported }));
        }
        refreshList();
        refreshCounts();
      })
      .catch(() => {
        if (!disposedRef.current) {
          toast.error(t('mail.importFailed'));
        }
      });
  };

  const purgeMessage = (id: string) => {
    askConfirm({
      title: t('mail.purgeTitle'),
      message: t('mail.purgeMessage'),
      confirmText: t('mail.purgeConfirm'),
      danger: true,
      action: () => {
        const context = routeRef.current;
        const next = neighborId(id);

        apiFetch(`/api/messages/${id}`, { method: 'DELETE' })
          .then(res => {
            if (disposedRef.current) {
              return;
            }

            if (!res.ok) {
              toast.error(t('mail.actionFailedRetry'));

              return;
            }
            toast.success(t('mail.purged'));
            refreshList();
            refreshCounts();

            if (sameMessageContext(id, context)) {
              navigate(viewPath(context.view, next, context.q), {
                replace: true,
              });
            }
          })
          .catch(() => {
            if (!disposedRef.current) {
              toast.error(t('mail.actionFailedRetry'));
            }
          });
      },
    });
  };

  const emptyMailbox = (mailbox: 'spam' | 'trash') => {
    const label = t(mailbox === 'spam' ? 'mail.spam' : 'mail.trash');

    askConfirm({
      title: t('mail.emptyMailboxTitle', { mailbox: label }),
      message: t('mail.emptyMailboxMessage'),
      confirmText: t('mail.emptyMailbox'),
      danger: true,
      action: () => {
        const context = routeRef.current;

        apiFetch(`/api/messages?mailbox=${mailbox}`, { method: 'DELETE' })
          .then(res => {
            if (disposedRef.current) {
              return;
            }

            if (!res.ok) {
              toast.error(t('mail.actionFailedRetry'));

              return;
            }
            toast.success(
              t(mailbox === 'spam' ? 'mail.spamEmptied' : 'mail.trashEmptied'),
            );
            refreshList();
            refreshCounts();

            const current = routeRef.current;

            if (
              current.view === mailbox &&
              current.q === context.q &&
              current.messageId
            ) {
              navigate(viewPath(mailbox, null, current.q), {
                replace: true,
              });
            }
          })
          .catch(() => {
            if (!disposedRef.current) {
              toast.error(t('mail.actionFailedRetry'));
            }
          });
      },
    });
  };

  return {
    search,
    setSearch,
    messages,
    nextCursor,
    loadingMore,
    loadMore,
    counts,
    refreshCounts,
    openMessage,
    messageLoading,
    refreshList,
    syncOpenMessage,
    discardDraft,
    downloadMessage,
    importMessages,
    moveMessage,
    purgeMessage,
    emptyMailbox,
  };
}
