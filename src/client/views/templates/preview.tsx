import {
  RiArrowLeftLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFileTextLine,
} from '@remixicon/react';

import { ActionMenu } from '#/client/components/action-menu';
import { BodyFrame } from '#/client/components/body-frame';
import { Button } from '#/client/components/button';
import { EmptyState } from '#/client/components/empty-state';
import { MessageView } from '#/client/components/message-view';
import { dateTimeValue, displayName, formatDate } from '#/client/format';
import { useEmailBody } from '#/client/hooks/use-email-body';
import type { Template } from '#/client/hooks/use-templates';
import { useI18n } from '#/client/i18n';

export interface TemplatePreviewProps {
  template: Template | null;
  user: { name: string; email: string };
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

/**
 * 模板预览：与邮件阅读器同构，仅操作区不同（编辑与删除）。
 */
export function TemplatePreview({
  template,
  user,
  onEdit,
  onDelete,
  onBack,
}: TemplatePreviewProps) {
  const { locale, t } = useI18n();
  const accountName = displayName(user);
  const { emailDocument, allowRemote, allowRemoteContent } = useEmailBody(
    template?.body_html ?? '',
    template?.id ?? '',
  );

  return (
    <section className="panel reader-pane" aria-label={t('templates.preview')}>
      {template ? (
        <>
          <div className="reader-head">
            <Button
              variant="icon"
              className="reader-back"
              onClick={onBack}
              aria-label={t('templates.back')}
            >
              <RiArrowLeftLine size={20} aria-hidden />
            </Button>
            <h2>{template.name}</h2>
            <ActionMenu
              className="reader-actions"
              items={[
                {
                  label: t('templates.edit'),
                  icon: <RiEditLine size={20} aria-hidden />,
                  run: () => onEdit(template.id),
                },
                {
                  label: t('templates.delete'),
                  icon: <RiDeleteBinLine size={20} aria-hidden />,
                  run: () => onDelete(template.id),
                },
              ]}
            />
          </div>
          <hr />
          <MessageView
            avatarName={accountName}
            correspondent={accountName}
            addr={user.email}
            when={formatDate(template.updated_at, locale)}
            dateTime={dateTimeValue(template.updated_at)}
            remoteContent={
              emailDocument.hasRemoteContent && !allowRemote
                ? allowRemoteContent
                : undefined
            }
          >
            <BodyFrame
              key={template.id}
              srcDoc={emailDocument.html}
              title={t('templates.body')}
            />
          </MessageView>
        </>
      ) : (
        <EmptyState icon={<RiFileTextLine aria-hidden />}>
          {t('templates.selectHint')}
        </EmptyState>
      )}
    </section>
  );
}
