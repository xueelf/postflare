import {
  RiArrowLeftLine,
  RiAttachmentLine,
  RiDeleteBin2Line,
  RiDeleteBinLine,
  RiDownloadLine,
  RiEditLine,
  RiInboxLine,
  RiInboxUnarchiveLine,
  RiMailForbidLine,
  RiMailLine,
} from '@remixicon/react';
import { type ReactNode } from 'react';

import { ActionMenu } from '#/client/components/action-menu';
import { BodyFrame } from '#/client/components/body-frame';
import { Button } from '#/client/components/button';
import { EmptyState } from '#/client/components/empty-state';
import { MessageView } from '#/client/components/message-view';
import { dateTimeValue, formatDate, formatSize } from '#/client/format';
import type { MessageDetail } from '#/client/hooks/use-messages';
import { useI18n } from '#/client/i18n';
import type { View } from '#/client/route';

export interface ReaderProps {
  message: MessageDetail | null;
  view: View;
  accountName: string;
  accountEmail: string;
  onBack: () => void;
  onCompose: () => void;
  onDiscard: () => void;
  onDownload: () => void;
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
  onDownload,
  onMove,
  onPurge,
}: ReaderProps) {
  const { locale, t } = useI18n();

  if (!message) {
    return (
      <section className="panel reader-pane" aria-label={t('mail.reader')}>
        <EmptyState icon={<RiMailLine aria-hidden />}>
          {t('mail.selectMessage')}
        </EmptyState>
      </section>
    );
  }

  const quote = message.body_html
    ? { visible: '', quoted: '' }
    : splitQuoted(message.body_text ?? '');
  const correspondent =
    message.direction === 'outbound'
      ? accountName
      : message.from_name || message.from_address;
  const actions: Array<{ icon: ReactNode; label: string; run: () => void }> = [
    {
      icon: <RiEditLine size={20} aria-hidden />,
      label: view === 'drafts' ? t('mail.editDraft') : t('mail.compose'),
      run: onCompose,
    },
  ];

  // 草稿是本地副本，没有可下载的原文
  if (view !== 'drafts') {
    actions.push({
      icon: <RiDownloadLine size={20} aria-hidden />,
      label: t('mail.download'),
      run: onDownload,
    });
  }

  if (view === 'inbox') {
    actions.push(
      {
        icon: <RiMailForbidLine size={20} aria-hidden />,
        label: t('mail.markSpam'),
        run: () => onMove('spam'),
      },
      {
        icon: <RiDeleteBinLine size={20} aria-hidden />,
        label: t('mail.delete'),
        run: () => onMove('trash'),
      },
    );
  } else if (view === 'spam') {
    actions.push(
      {
        icon: <RiInboxLine size={20} aria-hidden />,
        label: t('mail.notSpam'),
        run: () => onMove('inbox'),
      },
      {
        icon: <RiDeleteBinLine size={20} aria-hidden />,
        label: t('mail.delete'),
        run: () => onMove('trash'),
      },
    );
  } else if (view === 'trash') {
    actions.push(
      {
        icon: <RiInboxUnarchiveLine size={20} aria-hidden />,
        label: t('mail.restore'),
        run: () => onMove(message.direction === 'inbound' ? 'inbox' : 'sent'),
      },
      {
        icon: <RiDeleteBin2Line size={20} aria-hidden />,
        label: t('mail.purge'),
        run: onPurge,
      },
    );
  } else if (view === 'sent') {
    actions.push({
      icon: <RiDeleteBinLine size={20} aria-hidden />,
      label: t('mail.delete'),
      run: () => onMove('trash'),
    });
  } else if (view === 'drafts') {
    actions.push({
      icon: <RiDeleteBinLine size={20} aria-hidden />,
      label: t('mail.discard'),
      run: onDiscard,
    });
  }

  return (
    <section className="panel reader-pane" aria-label={t('mail.reader')}>
      <div className="reader-head">
        <Button
          variant="icon"
          className="reader-back"
          onClick={onBack}
          aria-label={t('mail.back')}
        >
          <RiArrowLeftLine size={20} aria-hidden />
        </Button>
        <h2>{message.subject || t('mail.noSubject')}</h2>
        <ActionMenu className="reader-actions" items={actions} />
      </div>
      <hr />
      <MessageView
        avatarName={correspondent}
        correspondent={correspondent}
        addr={
          message.direction === 'outbound'
            ? accountEmail
            : message.from_name
              ? message.from_address
              : undefined
        }
        when={formatDate(message.created_at, locale)}
        dateTime={dateTimeValue(message.created_at)}
        detailsId="message-details"
      >
        <dl id="message-details" popover="auto" className="message-details">
          <dt>{t('mail.from')}</dt>
          <dd>{message.from_address}</dd>
          <dt>{t('mail.to')}</dt>
          <dd>{message.to_address}</dd>
          <dt>{t('mail.subject')}</dt>
          <dd>{message.subject || t('mail.noSubject')}</dd>
          <dt>{t('mail.date')}</dt>
          <dd>{formatDate(message.created_at, locale)}</dd>
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
          <BodyFrame html={message.body_html} title={t('mail.body')} />
        ) : (
          <>
            <pre className="body-text">{quote.visible || t('mail.noBody')}</pre>
            {quote.quoted && (
              <details className="quote">
                <summary>{t('mail.showQuoted')}</summary>
                <pre className="body-text quoted">{quote.quoted}</pre>
              </details>
            )}
          </>
        )}
      </MessageView>
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
