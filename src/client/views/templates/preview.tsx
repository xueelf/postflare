import {
  RiArrowLeftLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFileTextLine,
} from '@remixicon/react';

import { ActionMenu } from '../../components/action-menu';
import { Button } from '../../components/button';
import { EmptyState } from '../../components/empty-state';
import { MessageView } from '../../components/message-view';
import {
  dateTimeValue,
  displayName,
  emailHtml,
  formatDate,
  templateHtml,
} from '../../format';
import type { Template } from '../../hooks/use-templates';

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
  const accountName = displayName(user);

  return (
    <section className="panel reader-pane" aria-label="模板预览">
      {template ? (
        <>
          <div className="reader-head">
            <Button
              variant="icon"
              className="reader-back"
              onClick={onBack}
              aria-label="返回"
            >
              <RiArrowLeftLine size={20} aria-hidden />
            </Button>
            <h2>{template.name}</h2>
            <ActionMenu
              className="reader-actions"
              items={[
                {
                  label: '编辑',
                  icon: <RiEditLine size={20} aria-hidden />,
                  run: () => onEdit(template.id),
                },
                {
                  label: '删除',
                  icon: <RiDeleteBinLine size={20} aria-hidden />,
                  run: () => onDelete(template.id),
                },
              ]}
            />
          </div>
          <hr />
          <div className="conversation">
            <MessageView
              avatarName={accountName}
              correspondent={accountName}
              addr={user.email}
              when={formatDate(template.updated_at)}
              dateTime={dateTimeValue(template.updated_at)}
            >
              <iframe
                className="body-html"
                sandbox="allow-same-origin"
                srcDoc={emailHtml(templateHtml(template.body_html))}
                title="模板正文"
              />
            </MessageView>
          </div>
        </>
      ) : (
        <EmptyState icon={<RiFileTextLine aria-hidden />}>
          选择一个模板预览
        </EmptyState>
      )}
    </section>
  );
}
