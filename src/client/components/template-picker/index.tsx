import { RiFileTextLine, RiLoader4Line } from '@remixicon/react';
import { useState } from 'react';

import { Button } from '#/client/components/button';
import { EmptyState } from '#/client/components/empty-state';
import { Modal } from '#/client/components/modal';
import { dateTimeValue, formatListDate } from '#/client/format';
import type { Template } from '#/client/hooks/use-templates';
import { useI18n } from '#/client/i18n';

import './style.css';

export interface TemplatePickerProps {
  templates: Template[];
  onClose: () => void;
  onManage: () => void;
  onUse: (templateId: string) => Promise<boolean>;
}

/**
 * 写信入口的模板选择器，选中模板后创建草稿并打开写信窗口。
 */
export function TemplatePicker({
  templates,
  onClose,
  onManage,
  onUse,
}: TemplatePickerProps) {
  const { locale, t } = useI18n();
  const [usingId, setUsingId] = useState<string | null>(null);
  const busy = usingId !== null;

  const choose = async (templateId: string) => {
    if (busy) {
      return;
    }
    setUsingId(templateId);

    try {
      if (await onUse(templateId)) {
        onClose();

        return;
      }
    } catch {
      // onUse 已经负责提示，保留弹窗让用户重试
    }
    setUsingId(null);
  };

  return (
    <Modal
      title={t('ui.useTemplate')}
      size="page"
      onDismiss={busy ? undefined : onClose}
      footer={
        <>
          <Button
            className="template-picker-manage"
            onClick={onManage}
            disabled={busy}
          >
            {t('templates.manage')}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {t('ui.cancel')}
          </Button>
        </>
      }
    >
      {templates.length === 0 ? (
        <div className="template-picker-empty">
          <EmptyState icon={<RiFileTextLine aria-hidden />}>
            {t('templates.empty')}
          </EmptyState>
        </div>
      ) : (
        <ul className="template-picker-list">
          {templates.map(template => {
            const using = usingId === template.id;

            return (
              <li key={template.id}>
                <button
                  type="button"
                  className="template-picker-item"
                  disabled={busy}
                  onClick={() => {
                    choose(template.id).catch(() => {});
                  }}
                >
                  <span className="template-picker-name">{template.name}</span>
                  <span className="template-picker-meta">
                    {using ? (
                      <RiLoader4Line
                        className="template-picker-spin"
                        size={14}
                        aria-hidden
                      />
                    ) : null}
                    <time dateTime={dateTimeValue(template.updated_at)}>
                      {formatListDate(template.updated_at, locale)}
                    </time>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
