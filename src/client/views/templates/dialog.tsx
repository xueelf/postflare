import { RiFileUploadLine } from '@remixicon/react';
import { useEffect, useRef } from 'react';

import { Editor } from '../../components/editor';
import { Modal } from '../../components/modal';
import type { TemplateDraft } from '../../hooks/use-templates';

import './style.css';

import { Button } from '../../components/button';

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
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <Modal
      title={draft.id ? '编辑模板' : '新建模板'}
      size="lg"
      onDismiss={onDismiss}
      footer={
        <Button
          type="submit"
          form="template-form"
          variant="primary"
          disabled={saving || !draft.name.trim()}
        >
          {saving ? '保存中…' : '保存'}
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
          placeholder="名称"
          aria-label="名称"
        />
        <Editor
          html={draft.body_html}
          onChange={html => onChange({ ...draft, body_html: html })}
          toolbarEnd={
            <>
              <Button
                variant="icon"
                className="template-import"
                aria-label="导入模板"
                title="导入模板"
                onClick={() => fileRef.current?.click()}
              >
                <RiFileUploadLine size={20} aria-hidden />
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".eml"
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
          }
        />
      </form>
    </Modal>
  );
}
