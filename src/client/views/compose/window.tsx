import { RiDeleteBinLine, RiLoader4Line } from '@remixicon/react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '#/client/components/button';
import { InkyEditor } from '#/client/components/editor/inky';
import { useComposeWindow } from '#/client/hooks/use-compose-window';
import type { ComposeWindowState } from '#/client/hooks/use-compose-windows';
import type { ConfirmRequest } from '#/client/hooks/use-confirm';
import type { MessageDetail } from '#/client/hooks/use-messages';
import { useI18n } from '#/client/i18n';
import { EMAIL_MAX_BYTES } from '#/limits';

import { ComposeCloseDialog } from './close-dialog';
import { ComposeFrame } from './frame';
import { ComposeSaveStatus } from './status';

export interface ComposeWindowProps {
  info: ComposeWindowState;
  fullscreen: boolean;
  dockIndex: number;
  userId: string;
  askConfirm: (request: ConfirmRequest) => void;
  onDraftId: (windowId: string, draftId: string) => void;
  onClose: (windowId: string) => void;
  onMinimize: (windowId: string) => void;
  onRestore: (windowId: string) => void;
  onToggleFullscreen: (windowId: string) => void;
  onFocus: (windowId: string) => void;
  onMove: (windowId: string, x: number, y: number) => void;
  onRegisterSave: (windowId: string, save: () => Promise<boolean>) => void;
  onUnregisterSave: (windowId: string) => void;
  onDirtyChange: (windowId: string, dirty: boolean) => void;
  refreshList: () => void;
  refreshCounts: () => void;
  syncOpenMessage: (message: MessageDetail) => void;
}

/**
 * 单个写信窗口。最小化时保留同一个组件和 Hook，只切换展示。
 */
export function ComposeWindow({
  info,
  fullscreen,
  dockIndex,
  userId,
  askConfirm,
  onDraftId,
  onClose,
  onMinimize,
  onRestore,
  onToggleFullscreen,
  onFocus,
  onMove,
  onRegisterSave,
  onUnregisterSave,
  onDirtyChange,
  refreshList,
  refreshCounts,
  syncOpenMessage,
}: ComposeWindowProps) {
  const { t } = useI18n();
  const formId = useId();
  const toolbarAnchor = `--compose-toolbar-${info.id}`;
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [modeSlot, setModeSlot] = useState<HTMLDivElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
  const [closePrompt, setClosePrompt] = useState(false);
  const editor = useComposeWindow({
    userId,
    windowId: info.id,
    initialDraftId: info.draftId,
    initialTo: info.initialTo,
    onDraftId,
    onClose,
    refreshList,
    refreshCounts,
    syncOpenMessage,
  });
  const saveForLogoutRef = useRef(editor.saveForLogout);

  saveForLogoutRef.current = editor.saveForLogout;

  useEffect(() => {
    onRegisterSave(info.id, () => saveForLogoutRef.current());

    return () => onUnregisterSave(info.id);
  }, [info.id]);

  useEffect(() => {
    onDirtyChange(
      info.id,
      editor.dirty ||
        editor.uploading ||
        editor.saving ||
        editor.sending ||
        editor.closing ||
        editor.needsCleanup,
    );
  }, [
    info.id,
    editor.dirty,
    editor.uploading,
    editor.saving,
    editor.sending,
    editor.closing,
    editor.needsCleanup,
  ]);

  const editing = Boolean(info.draftId);
  const locked =
    editor.readOnly || editor.closing || editor.sending || editor.discarding;
  const editable =
    !editor.readOnly &&
    !editor.loading &&
    !editor.loadFailed &&
    !editor.closing &&
    !editor.sending &&
    !editor.discarding;

  const requestClose = () => {
    if (editor.loading) {
      onClose(info.id);

      return;
    }

    if (
      (editor.readOnly && !editor.dirty) ||
      editor.loadFailed ||
      (editor.missing && (!editor.loaded || !editor.dirty))
    ) {
      onClose(info.id);

      return;
    }

    if (!editor.dirty && !editor.uploading && !editor.saving) {
      if (editor.needsCleanup) {
        editor.saveAndClose().catch(() => {});

        return;
      }
      onClose(info.id);

      return;
    }

    setClosePrompt(true);
  };

  const requestDiscard = () => {
    askConfirm({
      title: t('mail.discardTitle'),
      message: t('mail.discardMessage'),
      confirmText: t('mail.discard'),
      danger: true,
      action: () => {
        editor.discard().catch(() => {});
      },
    });
  };

  return (
    <>
      <ComposeFrame
        title={editing ? t('app.editDraft') : t('app.newMessage')}
        x={info.x}
        y={info.y}
        z={info.z}
        minimized={info.minimized}
        fullscreen={fullscreen}
        dockIndex={dockIndex}
        dockTitle={editor.subject.trim() || t('app.newMessage')}
        dockStatus={editor.status}
        busy={editor.closing || editor.sending || editor.discarding}
        closing={editor.closing}
        closeDisabled={editor.sending || editor.discarding}
        onFocus={() => onFocus(info.id)}
        onMove={(x, y) => onMove(info.id, x, y)}
        onMinimize={() => onMinimize(info.id)}
        onRestore={() => onRestore(info.id)}
        onToggleFullscreen={() => onToggleFullscreen(info.id)}
        onClose={requestClose}
        onSaveShortcut={() => {
          editor.saveNow().catch(() => {});
        }}
        status={
          <>
            <ComposeSaveStatus state={editor.saveState} text={editor.status} />
            <div className="compose-status-meta" ref={setStatusSlot} />
          </>
        }
        toolbar={
          <>
            {!editor.readOnly && !editor.missing && !editor.loadFailed && (
              <>
                <Button
                  variant="icon"
                  onClick={requestDiscard}
                  disabled={locked}
                  aria-label={t('mail.discard')}
                  title={t('mail.discard')}
                >
                  <RiDeleteBinLine size={20} aria-hidden />
                </Button>
                <span className="compose-toolbar-divider" aria-hidden />
              </>
            )}
            <div className="compose-toolbar-scroll" ref={setToolbarSlot} />
            <div className="compose-toolbar-actions">
              <div className="compose-mode-slot" ref={setModeSlot} />
              {editor.readOnly && (
                <Button
                  onClick={() => {
                    editor.retryLock().catch(() => {});
                  }}
                >
                  {t('compose.editHere')}
                </Button>
              )}
              {(editor.missing || (editor.readOnly && editor.dirty)) && (
                <Button
                  onClick={() => {
                    editor.saveAsNew().catch(() => {});
                  }}
                >
                  {t('compose.saveAsNew')}
                </Button>
              )}
              {editor.loadFailed && !editor.readOnly && (
                <Button
                  onClick={() => {
                    editor.retryLoad().catch(() => {});
                  }}
                >
                  {t('common.retry')}
                </Button>
              )}
              <Button
                type="submit"
                form={formId}
                variant="primary"
                className="compose-send"
                disabled={
                  locked ||
                  editor.loading ||
                  editor.loadFailed ||
                  editor.missing ||
                  editor.uploading ||
                  !editor.to.trim() ||
                  !editor.source.trim()
                }
              >
                {editor.sending ? (
                  <RiLoader4Line
                    className="compose-spin"
                    size={18}
                    aria-hidden
                  />
                ) : null}
                {t('compose.send')}
              </Button>
            </div>
          </>
        }
        toolbarAnchor={toolbarAnchor}
      >
        <form
          id={formId}
          className="compose-form"
          onSubmit={event => {
            event.preventDefault();
            editor.send().catch(() => {});
          }}
        >
          <input
            className="compose-line"
            value={editor.to}
            autoFocus={!editing && !editor.loading}
            disabled={!editable}
            onChange={event => editor.setTo(event.target.value)}
            placeholder={t('compose.to')}
            aria-label={t('compose.to')}
          />
          <input
            className="compose-line"
            value={editor.subject}
            disabled={!editable}
            onChange={event => editor.setSubject(event.target.value)}
            placeholder={t('compose.subject')}
            aria-label={t('compose.subject')}
          />
          <InkyEditor
            source={editor.source}
            onChange={editor.updateSource}
            onUploadImage={editor.uploadImage}
            onUploadingChange={editor.setUploading}
            disabled={!editable}
            toolbarTarget={toolbarSlot}
            modeTarget={modeSlot}
            statusTarget={statusSlot}
            componentsAnchor={toolbarAnchor}
            maxBytes={EMAIL_MAX_BYTES}
          />
        </form>
      </ComposeFrame>
      {closePrompt ? (
        <ComposeCloseDialog
          busy={editor.closing}
          error={editor.error || undefined}
          onSave={() => {
            editor.saveAndClose().catch(() => {});
          }}
          onDiscard={() => {
            editor.discardAndClose().catch(() => {});
          }}
          onCancel={() => setClosePrompt(false)}
        />
      ) : null}
    </>
  );
}
