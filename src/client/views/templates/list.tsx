import { RiFileTextLine } from '@remixicon/react';
import { useMemo, useRef } from 'react';

import { Button } from '#/client/components/button';
import { EmptyState } from '#/client/components/empty-state';
import { ListHead } from '#/client/components/list-head';
import { ListRow } from '#/client/components/list-row';
import { dateTimeValue, formatListDate, htmlToText } from '#/client/format';
import type { Template } from '#/client/hooks/use-templates';
import { useI18n } from '#/client/i18n';

export interface TemplateListProps {
  templates: Template[];
  openId: string | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleSidebar: () => void;
  user: { name: string; email: string };
  onImportEmail: (files: File[]) => void;
  onImportTemplate: (files: File[]) => void;
  onLogout: () => void;
  onMenu: () => void;
}

/**
 * 模板列表负责搜索与选中，模板导入入口在账户菜单与空态按钮。
 */
export function TemplateList({
  templates,
  openId,
  search,
  onSearch,
  onSelect,
  collapsed,
  onToggleSidebar,
  user,
  onImportEmail,
  onImportTemplate,
  onLogout,
  onMenu,
}: TemplateListProps) {
  const { locale, t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  // 正文转纯文本只做一次，输入框每次输入都会重渲染
  const items = useMemo(
    () =>
      templates.map(template => ({
        ...template,
        text: htmlToText(template.body_html),
      })),
    [templates],
  );
  const visible = query
    ? items.filter(item =>
        [item.name, item.text].some(text => text.toLowerCase().includes(query)),
      )
    : items;

  return (
    <section className="panel list-pane" aria-label={t('templates.title')}>
      <ListHead
        collapsed={collapsed}
        onToggleSidebar={onToggleSidebar}
        onMenu={onMenu}
        search={search}
        onSearch={onSearch}
        searchPlaceholder={t('templates.search')}
        accountMenuId="account-menu-templates"
        user={user}
        onImportEmail={onImportEmail}
        onImportTemplate={onImportTemplate}
        onLogout={onLogout}
      />
      {visible.length === 0 ? (
        <EmptyState
          icon={<RiFileTextLine aria-hidden />}
          action={
            query ? undefined : (
              <Button
                variant="primary"
                onClick={() => fileRef.current?.click()}
              >
                {t('templates.importTemplate')}
              </Button>
            )
          }
        >
          {query ? t('templates.noMatch') : t('templates.empty')}
        </EmptyState>
      ) : (
        <ul className="list-body">
          {visible.map(template => {
            const selected = openId === template.id;

            return (
              <ListRow
                key={template.id}
                selected={selected}
                title={template.name}
                text={template.text || t('templates.noBody')}
                dateTime={dateTimeValue(template.updated_at)}
                when={formatListDate(template.updated_at, locale)}
                onOpen={() => onSelect(template.id)}
              />
            );
          })}
        </ul>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".inky"
        multiple
        hidden
        onChange={event => {
          const files = Array.from(event.target.files ?? []);

          // 清空 value，同一批文件可以再次选择
          event.target.value = '';

          if (files.length > 0) {
            onImportTemplate(files);
          }
        }}
      />
    </section>
  );
}
