import { useEffect, useRef } from 'react';

import { InkyEditor } from '#/client/components/editor/inky';
import { Modal } from '#/client/components/modal';

import './style.css';

import { Button } from '#/client/components/button';
import { useI18n } from '#/client/i18n';

export interface ComposeContent {
  source: string;
  text: string;
  html: string;
}

export interface ComposeProps {
  title: string;
  to: string;
  subject: string;
  text: string;
  source: string;
  html: string;
  busy: boolean;
  status: string;
  onToChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onContentChange: (content: ComposeContent) => void;
  onSend: () => void;
  onDismiss: () => void;
}

/**
 * 写信弹窗：模态编辑，输入停止后自动保存草稿，关闭与丢弃由调用方处理。
 */
export function Compose({
  title,
  to,
  subject,
  text,
  source,
  html,
  busy,
  status,
  onToChange,
  onSubjectChange,
  onContentChange,
  onSend,
  onDismiss,
}: ComposeProps) {
  const { t } = useI18n();
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    toRef.current?.focus();
  }, []);

  return (
    <Modal
      title={title}
      size="lg"
      onDismiss={onDismiss}
      footer={
        <>
          <span className="compose-status" role="status">
            {status}
          </span>
          <Button
            type="submit"
            form="compose-form"
            variant="primary"
            disabled={
              busy ||
              !to.trim() ||
              (!text.trim() &&
                !html.includes('<img') &&
                !source.includes('<image'))
            }
          >
            {busy ? t('compose.sending') : t('compose.send')}
          </Button>
        </>
      }
    >
      <form
        id="compose-form"
        className="compose-form"
        onSubmit={event => {
          event.preventDefault();
          onSend();
        }}
      >
        <input
          ref={toRef}
          className="compose-line"
          value={to}
          onChange={event => onToChange(event.target.value)}
          placeholder={t('compose.to')}
          aria-label={t('compose.to')}
        />
        <input
          className="compose-line"
          value={subject}
          onChange={event => onSubjectChange(event.target.value)}
          placeholder={t('compose.subject')}
          aria-label={t('compose.subject')}
        />
        <InkyEditor source={source} onChange={onContentChange} />
      </form>
    </Modal>
  );
}
