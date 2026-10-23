import { RiFileUploadLine } from '@remixicon/react';
import { useEffect, useRef } from 'react';

import { InkyEditor } from '#/client/components/editor/inky';
import { Modal } from '#/client/components/modal';
import type { TemplateDraft } from '#/client/hooks/use-templates';
import { useI18n } from '#/client/i18n';

import './style.css';

import { Button } from '#/client/components/button';

export interface TemplateDialogProps {
  draft: TemplateDraft;
  saving: boolean;
  onChange: (draft: TemplateDraft) => void;
  onSave: () => void;
  onImportFile: (file: File) => void;
  onDismiss: () => void;
}

/**
 * 模板弹窗：新建与编辑共用写信同款表单与编辑器，字段为名称与正文。
 */
export function TemplateDialog({
  draft,
  saving,
  onChange,
  onSave,
  onImportFile,
  onDismiss,
}: TemplateDialogProps) {
  const { t } = useI18n();
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const toolbarEnd = (
    <>
      <Button
        variant="icon"
        className="template-import"
        aria-label={t('templates.importTemplate')}
        title={t('templates.importTemplate')}
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

          // 清空 value，同一个文件可以再次选择
          event.target.value = '';

          if (file) {
            onImportFile(file);
          }
        }}
      />
    </>
  );

  return (
    <Modal
      title={t('templates.editTemplate')}
      size="lg"
      onDismiss={onDismiss}
      footer={
        <Button
          type="submit"
          form="template-form"
          variant="primary"
          disabled={saving || !draft.name.trim()}
        >
          {saving ? t('templates.saving') : t('templates.save')}
        </Button>
      }
    >
      <form
        id="template-form"
        className="compose-form"
        onSubmit={event => {
          event.preventDefault();
          onSave();
        }}
      >
        <input
          ref={nameRef}
          className="compose-line"
          value={draft.name}
          onChange={event => onChange({ ...draft, name: event.target.value })}
          placeholder={t('templates.name')}
          aria-label={t('templates.name')}
        />
        <InkyEditor
          source={draft.body_source}
          onChange={content =>
            onChange({
              ...draft,
              body_source: content.source,
              body_html: content.html,
            })
          }
          toolbarEnd={toolbarEnd}
        />
      </form>
    </Modal>
  );
}
