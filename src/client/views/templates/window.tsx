import {
  RiDeleteBinLine,
  RiFileUploadLine,
  RiLoader4Line,
} from '@remixicon/react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '#/client/components/button';
import { InkyEditor } from '#/client/components/editor/inky';
import type { ComposeWindowState } from '#/client/hooks/use-compose-windows';
import type { ConfirmRequest } from '#/client/hooks/use-confirm';
import { useTemplateWindow } from '#/client/hooks/use-template-window';
import type { Template } from '#/client/hooks/use-templates';
import { useI18n } from '#/client/i18n';
import { MAX_TEMPLATE_BYTES } from '#/limits';

import { ComposeCloseDialog } from '../compose/close-dialog';
import { ComposeFrame } from '../compose/frame';
import { ComposeSaveStatus } from '../compose/status';

export interface TemplateWindowProps {
  info: ComposeWindowState;
  template: Template | null;
  fullscreen: boolean;
  dockIndex: number;
  userId: string;
  onClose: (windowId: string) => void;
  onMinimize: (windowId: string) => void;
  onRestore: (windowId: string) => void;
  onToggleFullscreen: (windowId: string) => void;
  onFocus: (windowId: string) => void;
  onMove: (windowId: string, x: number, y: number) => void;
  onRegisterSave: (windowId: string, save: () => Promise<boolean>) => void;
  onUnregisterSave: (windowId: string) => void;
  onDirtyChange: (windowId: string, dirty: boolean) => void;
  onCreated: (templateId: string) => void;
  onDeleted: () => void;
  askConfirm: (request: ConfirmRequest) => void;
  refreshTemplates: () => void;
}

/**
 * 模板编辑窗口，与写信共用窗口框架、编辑器和底部工具栏。
 */
export function TemplateWindow({
  info,
  template,
  fullscreen,
  dockIndex,
  userId,
  onClose,
  onMinimize,
  onRestore,
  onToggleFullscreen,
  onFocus,
  onMove,
  onRegisterSave,
  onUnregisterSave,
  onDirtyChange,
  onCreated,
  onDeleted,
  askConfirm,
  refreshTemplates,
}: TemplateWindowProps) {
  const { t } = useI18n();
  const formId = useId();
  const toolbarAnchor = `--compose-toolbar-${info.id}`;
  const fileRef = useRef<HTMLInputElement>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [modeSlot, setModeSlot] = useState<HTMLDivElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
  const [closePrompt, setClosePrompt] = useState(false);
  const editor = useTemplateWindow({
    userId,
    windowId: info.id,
    templateId: info.templateId ?? '',
    initial: {
      name: template?.name ?? '',
      subject: template?.subject ?? '',
      source: template?.body_source ?? '',
    },
    onClose,
    onCreated,
    onDeleted,
    refreshTemplates,
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
        editor.closing ||
        editor.needsCleanup,
    );
  }, [
    info.id,
    editor.dirty,
    editor.uploading,
    editor.saving,
    editor.closing,
    editor.needsCleanup,
  ]);

  const editable =
    !editor.loading && !editor.readOnly && !editor.missing && !editor.closing;

  const requestClose = () => {
    if (
      editor.loading ||
      editor.readOnly ||
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

  const requestDelete = () => {
    askConfirm({
      title: t('templates.confirmDelete'),
      message: t('templates.deleteWarning'),
      confirmText: t('templates.delete'),
      danger: true,
      action: () => {
        editor.deleteTemplate().catch(() => {});
      },
    });
  };

  const importFile = async (file: File) => {
    const source = await file.text();
    const name = file.name.replace(/\.inky$/i, '').trim();
    const apply = () => {
      if (editor.closing || editor.readOnly) {
        return;
      }
      editor.updateSource(source);

      if (name) {
        editor.setName(name);
      }
    };

    askConfirm({
      title: name
        ? t('templates.importReplaceAll')
        : t('templates.importReplaceBody'),
      message: t('templates.importOverwrite'),
      confirmText: t('templates.replace'),
      danger: true,
      action: apply,
    });
  };

  const componentEnd = (
    <>
      <Button
        variant="icon"
        aria-label={t('templates.importTemplate')}
        title={t('templates.importTemplate')}
        disabled={!editable || editor.saving}
        onClick={() => fileRef.current?.click()}
      >
        <RiFileUploadLine size={20} aria-hidden />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".inky"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];

          event.target.value = '';

          if (file) {
            importFile(file).catch(() => {});
          }
        }}
      />
    </>
  );

  return (
    <>
      <ComposeFrame
        title={t('templates.editTemplate')}
        x={info.x}
        y={info.y}
        z={info.z}
        minimized={info.minimized}
        fullscreen={fullscreen}
        dockIndex={dockIndex}
        dockTitle={editor.name.trim() || t('templates.untitled')}
        dockStatus={editor.status}
        busy={editor.saving || editor.closing}
        closing={editor.closing}
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
            {!editor.readOnly && !editor.missing && !editor.loading && (
              <>
                <Button
                  variant="icon"
                  onClick={requestDelete}
                  disabled={editor.saving || editor.uploading || editor.closing}
                  aria-label={t('templates.delete')}
                  title={t('templates.delete')}
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
                  disabled={editor.loading || editor.closing}
                  onClick={() => {
                    editor.retryLock().catch(() => {});
                  }}
                >
                  {editor.loadFailed
                    ? t('common.retry')
                    : t('compose.editHere')}
                </Button>
              )}
              {editor.missing && (
                <Button
                  disabled={editor.closing}
                  onClick={() => {
                    editor.saveAsNew().catch(() => {});
                  }}
                >
                  {editor.closing ? (
                    <RiLoader4Line
                      className="compose-spin"
                      size={18}
                      aria-hidden
                    />
                  ) : null}
                  {t('templates.saveAsNew')}
                </Button>
              )}
              <Button
                variant="primary"
                className="compose-send"
                onClick={() => {
                  editor.saveNow().catch(() => {});
                }}
                disabled={
                  !editable ||
                  editor.saving ||
                  editor.uploading ||
                  !editor.name.trim()
                }
              >
                {editor.saving ? (
                  <RiLoader4Line
                    className="compose-spin"
                    size={18}
                    aria-hidden
                  />
                ) : null}
                {t('templates.save')}
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
            editor.saveNow().catch(() => {});
          }}
        >
          <input
            className="compose-line"
            value={editor.name}
            disabled={!editable || editor.saving}
            onChange={event => editor.setName(event.target.value)}
            placeholder={t('templates.name')}
            aria-label={t('templates.name')}
          />
          <input
            className="compose-line"
            value={editor.subject}
            disabled={!editable || editor.saving}
            onChange={event => editor.setSubject(event.target.value)}
            placeholder={t('compose.subject')}
            aria-label={t('compose.subject')}
          />
          <InkyEditor
            source={editor.source}
            onChange={editor.updateSource}
            onUploadImage={editor.uploadImage}
            onUploadingChange={editor.setUploading}
            disabled={!editable || editor.saving}
            componentEnd={componentEnd}
            toolbarTarget={toolbarSlot}
            modeTarget={modeSlot}
            statusTarget={statusSlot}
            componentsAnchor={toolbarAnchor}
            maxBytes={MAX_TEMPLATE_BYTES}
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
