import { RiMailLine } from '@remixicon/react';
import { useEffect, useRef } from 'react';

import { EmptyState } from '#/client/components/empty-state';
import { ListHead } from '#/client/components/list-head';
import { ListRow } from '#/client/components/list-row';
import { dateTimeValue, formatListDate } from '#/client/format';
import type { MessageSummary } from '#/client/hooks/use-messages';
import { type MessageKey, type MessageParams, useI18n } from '#/client/i18n';
import type { View } from '#/client/route';

export interface MessageListProps {
  view: View;
  messages: MessageSummary[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  search: string;
  onSearch: (value: string) => void;
  onOpen: (message: MessageSummary) => void;
  emptyText: string;
  openId: string | null;
  collapsed: boolean;
  onToggleSidebar: () => void;
  onMenu: () => void;
  user: { name: string; email: string };
  onCreateTemplate: () => void;
  onLogout: () => void;
}

function correspondent(
  message: MessageSummary,
  t: (key: MessageKey, params?: MessageParams) => string,
): string {
  return message.direction === 'inbound'
    ? message.from_name || message.from_address
    : t('mail.sentTo', {
        address: message.to_address || t('mail.noRecipient'),
      });
}

/**
 * 邮件列表：搜索与邮件条目。
 */
export function MessageList({
  view,
  messages,
  nextCursor,
  loadingMore,
  onLoadMore,
  search,
  onSearch,
  onOpen,
  emptyText,
  openId,
  collapsed,
  onToggleSidebar,
  onMenu,
  user,
  onCreateTemplate,
  onLogout,
}: MessageListProps) {
  const { locale, t } = useI18n();
  const sentinel = useRef<HTMLLIElement>(null);
  const loadMoreRef = useRef(onLoadMore);

  loadMoreRef.current = onLoadMore;

  // 触底前 200px 开始取下一页，避免滚动到底后等待
  useEffect(() => {
    const node = sentinel.current;

    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          loadMoreRef.current();
        }
      },
      { rootMargin: '200px 0px' },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [nextCursor]);

  return (
    <section className="panel list-pane" aria-label={t('mail.list')}>
      <ListHead
        collapsed={collapsed}
        onToggleSidebar={onToggleSidebar}
        onMenu={onMenu}
        search={search}
        onSearch={onSearch}
        searchPlaceholder={t('mail.search')}
        accountMenuId="account-menu-mobile"
        user={user}
        onCreateTemplate={onCreateTemplate}
        onLogout={onLogout}
      />
      {messages.length === 0 ? (
        <EmptyState icon={<RiMailLine aria-hidden />}>{emptyText}</EmptyState>
      ) : (
        <ul className="list-body">
          {messages.map(message => {
            const unread =
              (view === 'inbox' || view === 'spam') && message.seen === 0;
            const selected = openId === message.id;
            const created =
              view === 'drafts' ? message.updated_at : message.created_at;

            return (
              <ListRow
                key={message.id}
                selected={selected}
                unread={unread}
                title={correspondent(message, t)}
                subtitle={
                  message.direction === 'inbound' && message.from_name
                    ? message.from_address
                    : undefined
                }
                text={message.subject || t('mail.noSubject')}
                dateTime={dateTimeValue(created)}
                when={formatListDate(created, locale)}
                onOpen={() => onOpen(message)}
              />
            );
          })}
          {nextCursor && (
            <li ref={sentinel} className="list-more" role="status">
              {loadingMore ? t('common.loading') : ''}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
