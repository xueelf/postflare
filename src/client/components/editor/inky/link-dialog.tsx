import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { Button } from '#/client/components/button';
import { Modal } from '#/client/components/modal';
import { useI18n } from '#/client/i18n';

export interface LinkDialogProps {
  initialText: string;
  initialUrl: string;
  onSubmit: (text: string, url: string) => void;
  onDismiss: () => void;
}

/**
 * 插入链接弹窗：确认显示文本与地址后，只插入普通的 a 标签。
 */
export function LinkDialog({
  initialText,
  initialUrl,
  onSubmit,
  onDismiss,
}: LinkDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const textRef = useRef<HTMLInputElement>(null);
  const canSubmit = Boolean(text.trim() && url.trim());

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      textRef.current?.focus();
      textRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit(text.trim(), url.trim());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Modal
      title={t('compose.insertLink')}
      onDismiss={onDismiss}
      footer={
        <>
          <Button onClick={onDismiss}>{t('ui.cancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {t('compose.insert')}
          </Button>
        </>
      }
    >
      <div className="inky-link-dialog">
        <label className="inky-link-field">
          <span>{t('compose.linkText')}</span>
          <input
            ref={textRef}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
        <label className="inky-link-field">
          <span>{t('compose.linkUrl')}</span>
          <input
            value={url}
            onChange={event => setUrl(event.target.value)}
            onKeyDown={handleKeyDown}
            inputMode="url"
            placeholder="https://"
          />
        </label>
      </div>
    </Modal>
  );
}
