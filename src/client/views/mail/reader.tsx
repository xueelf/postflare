import {
  RiArrowLeftLine,
  RiAttachmentLine,
  RiDeleteBin2Line,
  RiDeleteBinLine,
  RiEditLine,
  RiInboxLine,
  RiInboxUnarchiveLine,
  RiMailForbidLine,
  RiMailLine,
} from '@remixicon/react';
import { type ReactNode } from 'react';

import { ActionMenu } from '../../components/action-menu';
import { Button } from '../../components/button';
import { EmptyState } from '../../components/empty-state';
import { MessageView } from '../../components/message-view';
import { dateTimeValue, emailHtml, formatDate, formatSize } from '../../format';
import type { MessageDetail } from '../../hooks/use-messages';
import type { View } from '../../route';

export interface ReaderProps {
  message: MessageDetail | null;
  view: View;
  accountName: string;
  accountEmail: string;
  onBack: () => void;
  onCompose: () => void;
  onDiscard: () => void;
  onMove: (mailbox: 'inbox' | 'sent' | 'spam' | 'trash') => void;
  onPurge: () => void;
}

/**
 * 阅读面板：头部操作与邮件详情。
 */
export function Reader({
  message,
  view,
  accountName,
  accountEmail,
  onBack,
  onCompose,
  onDiscard,
  onMove,
  onPurge,
}: ReaderProps) {
  if (!message) {
    return (
      <section className="panel reader-pane" aria-label="邮件阅读">
        <EmptyState icon={<RiMailLine aria-hidden />}>
          选择一封邮件阅读
        </EmptyState>
      </section>
    );
  }

  const quote = message.body_html
    ? { visible: '', quoted: '' }
    : splitQuoted(message.body_text ?? '');
  const messageWho =
    message.direction === 'outbound'
      ? accountName
      : message.from_name || message.from_address;
  const actions: Array<{ icon: ReactNode; label: string; run: () => void }> = [
    {
      icon: <RiEditLine size={20} aria-hidden />,
      label: view === 'drafts' ? '编辑草稿' : '写邮件',
      run: onCompose,
    },
  ];

  if (view === 'inbox') {
    actions.push(
      {
        icon: <RiMailForbidLine size={20} aria-hidden />,
        label: '标记为垃圾邮件',
        run: () => onMove('spam'),
      },
      {
        icon: <RiDeleteBinLine size={20} aria-hidden />,
        label: '删除',
        run: () => onMove('trash'),
      },
    );
  } else if (view === 'spam') {
    actions.push(
      {
        icon: <RiInboxLine size={20} aria-hidden />,
        label: '不是垃圾邮件',
        run: () => onMove('inbox'),
      },
      {
        icon: <RiDeleteBinLine size={20} aria-hidden />,
        label: '删除',
        run: () => onMove('trash'),
      },
    );
  } else if (view === 'trash') {
    actions.push(
      {
        icon: <RiInboxUnarchiveLine size={20} aria-hidden />,
        label: '恢复',
        run: () => onMove(message.direction === 'inbound' ? 'inbox' : 'sent'),
      },
      {
        icon: <RiDeleteBin2Line size={20} aria-hidden />,
        label: '彻底删除',
        run: onPurge,
      },
    );
  } else if (view === 'sent') {
    actions.push({
      icon: <RiDeleteBinLine size={20} aria-hidden />,
      label: '删除',
      run: () => onMove('trash'),
    });
  } else if (view === 'drafts') {
    actions.push({
      icon: <RiDeleteBinLine size={20} aria-hidden />,
      label: '丢弃',
      run: onDiscard,
    });
  }

  return (
    <section className="panel reader-pane" aria-label="邮件阅读">
      <div className="reader-head">
        <Button
          variant="icon"
          className="reader-back"
          onClick={onBack}
          aria-label="返回"
        >
          <RiArrowLeftLine size={20} aria-hidden />
        </Button>
        <h2>{message.subject || '(无主题)'}</h2>
        <ActionMenu className="reader-actions" items={actions} />
      </div>
      <hr />
      <div className="conversation">
        <MessageView
          avatarName={messageWho}
          correspondent={messageWho}
          addr={
            message.direction === 'outbound'
              ? accountEmail
              : message.from_name
                ? message.from_address
                : undefined
          }
          when={formatDate(message.created_at)}
          dateTime={dateTimeValue(message.created_at)}
          detailsId="message-details"
        >
          <dl id="message-details" popover="auto" className="message-details">
            <dt>发件人</dt>
            <dd>{message.from_address}</dd>
            <dt>收件人</dt>
            <dd>{message.to_address}</dd>
            <dt>主题</dt>
            <dd>{message.subject || '(无主题)'}</dd>
            <dt>时间</dt>
            <dd>{formatDate(message.created_at)}</dd>
          </dl>
          {message.attachments.length > 0 && (
            <ul className="attachments">
              {message.attachments.map(file => (
                <li key={file.id}>
                  <a href={`/api/attachments/${file.id}`}>
                    <RiAttachmentLine size={14} aria-hidden />
                    {file.filename}
                  </a>
                  <span className="meta">{formatSize(file.size_bytes)}</span>
                </li>
              ))}
            </ul>
          )}
          {message.body_html ? (
            <iframe
              className="body-html"
              sandbox="allow-same-origin"
              srcDoc={emailHtml(message.body_html)}
              title="邮件正文"
            />
          ) : (
            <>
              <pre className="body-text">{quote.visible || '(无正文)'}</pre>
              {quote.quoted && (
                <details className="quote">
                  <summary>显示引用</summary>
                  <pre className="body-text quoted">{quote.quoted}</pre>
                </details>
              )}
            </>
          )}
        </MessageView>
      </div>
    </section>
  );
}

/**
 * 拆分正文与引用部分。
 */
function splitQuoted(text: string): { visible: string; quoted: string } {
  const lines = text.split('\n');
  const index = lines.findIndex(
    line => line.startsWith('>') || line.trimEnd().endsWith('写道：'),
  );

  if (index === -1) {
    return { visible: text.trimEnd(), quoted: '' };
  }
  return {
    visible: lines.slice(0, index).join('\n').trimEnd(),
    quoted: lines.slice(index).join('\n').trimEnd(),
  };
}
