import { RiMailLine } from '@remixicon/react';

import { EmptyState } from '../../components/empty-state';
import { ListHead } from '../../components/list-head';
import { ListRow } from '../../components/list-row';
import { dateTimeValue, formatListDate } from '../../format';
import type { MessageSummary } from '../../hooks/use-messages';
import type { View } from '../../route';

export interface MessageListProps {
  view: View;
  messages: MessageSummary[];
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

function correspondent(message: MessageSummary): string {
  return message.direction === 'inbound'
    ? message.from_name || message.from_address
    : `发给 ${message.to_address || '(无收件人)'}`;
}

/**
 * 邮件列表：搜索与邮件条目。
 */
export function MessageList({
  view,
  messages,
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
  return (
    <section className="panel list-pane" aria-label="邮件列表">
      <ListHead
        collapsed={collapsed}
        onToggleSidebar={onToggleSidebar}
        onMenu={onMenu}
        search={search}
        onSearch={onSearch}
        searchPlaceholder="搜索邮件"
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
                title={correspondent(message)}
                subtitle={
                  message.direction === 'inbound' && message.from_name
                    ? message.from_address
                    : undefined
                }
                text={message.subject || '(无主题)'}
                dateTime={dateTimeValue(created)}
                when={formatListDate(created)}
                onOpen={() => onOpen(message)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
