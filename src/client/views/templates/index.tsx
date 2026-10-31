import { type TemplateListProps, TemplateList } from './list';
import { type TemplatePreviewProps, TemplatePreview } from './preview';

export interface TemplatesProps
  extends TemplateListProps, Omit<TemplatePreviewProps, 'template'> {}

/**
 * 模板视图：列表与预览双栏，模板由 .inky 导入或另存为产生，编辑走弹窗。
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
