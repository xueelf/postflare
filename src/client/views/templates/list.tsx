import { RiFileTextLine } from '@remixicon/react';
import { useMemo } from 'react';

import { Button } from '../../components/button';
import { EmptyState } from '../../components/empty-state';
import { ListHead } from '../../components/list-head';
import { ListRow } from '../../components/list-row';
import { dateTimeValue, formatListDate, htmlToText } from '../../format';
import type { Template } from '../../hooks/use-templates';

export interface TemplateListProps {
  templates: Template[];
  openId: string | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleSidebar: () => void;
  user: { name: string; email: string };
  onCreateTemplate: () => void;
  onLogout: () => void;
  onMenu: () => void;
}

/**
 * 模板列表：搜索与选中；新建入口在头像菜单与空态按钮。
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
  onCreateTemplate,
  onLogout,
  onMenu,
}: TemplateListProps) {
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
    <section className="panel list-pane" aria-label="模板">
      <ListHead
        collapsed={collapsed}
        onToggleSidebar={onToggleSidebar}
        onMenu={onMenu}
        search={search}
        onSearch={onSearch}
        searchPlaceholder="搜索模板"
        accountMenuId="account-menu-templates"
        user={user}
        onCreateTemplate={onCreateTemplate}
        onLogout={onLogout}
      />
      {visible.length === 0 ? (
        <EmptyState
          icon={<RiFileTextLine aria-hidden />}
          action={
            query ? undefined : (
              <Button variant="primary" onClick={onCreateTemplate}>
                新建模板
              </Button>
            )
          }
        >
          {query ? '没有匹配的模板' : '还没有模板'}
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
                text={template.text || '(无正文)'}
                dateTime={dateTimeValue(template.updated_at)}
                when={formatListDate(template.updated_at)}
                onOpen={() => onSelect(template.id)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
