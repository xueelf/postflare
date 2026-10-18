import { useEffect, useRef } from 'react';

import { Editor } from '../../components/editor';
import { Modal } from '../../components/modal';

import './style.css';

import { Button } from '../../components/button';

export interface ComposeProps {
  title: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  busy: boolean;
  status: string;
  onToChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  onHtmlChange: (html: string, text: string) => void;
  onUploadImage: (file: File, html: string) => Promise<string>;
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
  html,
  busy,
  status,
  onToChange,
  onSubjectChange,
  onHtmlChange,
  onUploadImage,
  onSend,
  onDismiss,
}: ComposeProps) {
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
              busy || !to.trim() || (!text.trim() && !html.includes('<img'))
            }
          >
            {busy ? '发送中…' : '发送'}
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
          placeholder="收件人"
          aria-label="收件人"
        />
        <input
          className="compose-line"
          value={subject}
          onChange={event => onSubjectChange(event.target.value)}
          placeholder="主题"
          aria-label="主题"
        />
        <Editor
          html={html}
          onChange={onHtmlChange}
          onUploadImage={onUploadImage}
        />
      </form>
    </Modal>
  );
}
