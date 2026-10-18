import { type TemplateListProps, TemplateList } from './list';
import { type TemplatePreviewProps, TemplatePreview } from './preview';

import './style.css';

export interface TemplatesProps
  extends TemplateListProps, Omit<TemplatePreviewProps, 'template'> {}

/**
 * 模板视图：列表与预览双栏，新建与编辑走弹窗。
 */
export function Templates({ templates, ...rest }: TemplatesProps) {
  const template = templates.find(item => item.id === rest.openId) ?? null;

  return (
    <>
      <TemplateList templates={templates} {...rest} />
      <TemplatePreview template={template} {...rest} />
    </>
  );
}
