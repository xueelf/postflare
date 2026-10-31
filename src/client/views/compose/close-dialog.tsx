import { RiLoader4Line } from '@remixicon/react';

import { Button } from '#/client/components/button';
import { Modal } from '#/client/components/modal';
import { useI18n } from '#/client/i18n';

export interface ComposeCloseDialogProps {
  busy: boolean;
  error?: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/**
 * 关闭未保存窗口前的三选一确认，保存路径仍由窗口 Hook 串行处理。
 */
export function ComposeCloseDialog({
  busy,
  error,
  onSave,
  onDiscard,
  onCancel,
}: ComposeCloseDialogProps) {
  const { t } = useI18n();

  return (
    <Modal
      title={t('templates.unsavedChanges')}
      onDismiss={busy ? undefined : onCancel}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel}>
            {t('ui.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={onDiscard}>
            {t('compose.discardAndClose')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={onSave}>
            {busy ? (
              <RiLoader4Line className="compose-spin" size={18} aria-hidden />
            ) : null}
            {t('compose.saveAndClose')}
          </Button>
        </>
      }
    >
      <p className="confirm-text">{t('templates.discardMessage')}</p>
      {error ? (
        <p className="confirm-text" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
