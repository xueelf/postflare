import { useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import { apiFetch } from '../api';
import { useToast } from '../components/toast';
import { templateHtml } from '../format';
import { useI18n } from '../i18n';
import { type MailRoute, viewPath } from '../route';
import { parseTemplateFile } from '../template-import';

import type { ConfirmRequest } from './use-confirm';

export interface Template {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  updated_at: string;
}

export interface TemplateDraft {
  id: string | null;
  name: string;
  subject: string;
  body_html: string;
}

export interface TemplateDeps {
  navigate: NavigateFunction;
  closeDrawer: () => void;
  askConfirm: (request: ConfirmRequest) => void;
}

function newDraft(): TemplateDraft {
  return { id: null, name: '', subject: '', body_html: '' };
}

function draftOf(template: Template): TemplateDraft {
  return {
    id: template.id,
    name: template.name,
    subject: template.subject,
    body_html: templateHtml(template.body_html),
  };
}

/**
 * 模板：列表、新建/编辑弹窗状态与保存删除，弹窗由片段驱动。
 */
export function useTemplates(
  route: MailRoute,
  ready: boolean,
  deps: TemplateDeps,
) {
  const { navigate, closeDrawer, askConfirm } = deps;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const { t } = useI18n();

  const refreshTemplates = () =>
    apiFetch('/api/templates')
      .then(res => res.json<Template[]>())
      .then(data => {
        setTemplates(data);
        setLoaded(true);
      })
      .catch(() => {});

  useEffect(() => {
    if (!ready) {
      return;
    }
    refreshTemplates();
  }, [ready]);

  // 模板弹窗由片段驱动，编辑哪一份留在状态里；刷新时回落到路由上打开的那份
  useEffect(() => {
    if (!ready) {
      return;
    }

    if (!route.template) {
      setEditing(null);

      return;
    }
    setEditing(current => {
      if (current) {
        return current;
      }

      if (!route.messageId) {
        return newDraft();
      }
      const found = templates.find(item => item.id === route.messageId);

      if (found) {
        return draftOf(found);
      }
      // 列表还没到就再等一轮，别把编辑错落成新建
      return loaded ? newDraft() : current;
    });
  }, [ready, loaded, route.template, route.messageId, templates]);

  const openTemplate = (id?: string) => {
    closeDrawer();

    const found = id ? templates.find(item => item.id === id) : undefined;

    setEditing(found ? draftOf(found) : newDraft());
    navigate(`${route.path}#template`, { state: { pfTemplate: true } });
  };

  const saveTemplate = () => {
    if (!editing) {
      return;
    }

    setSaving(true);

    const payload = JSON.stringify({
      name: editing.name,
      subject: editing.subject,
      body_html: editing.body_html,
    });
    const request = editing.id
      ? apiFetch(`/api/templates/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
      : apiFetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });

    request
      .then(async res => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };

          toast.error(
            data.error ?? t('templates.saveFailed', { status: res.status }),
          );
          setSaving(false);

          return;
        }
        const data = (await res.json()) as { id: string };

        setSaving(false);

        if (editing.id) {
          navigate(route.path, { replace: true });
        } else {
          navigate(`/templates/${data.id}`);
        }
        refreshTemplates();
      })
      .catch(() => {
        toast.error(t('templates.saveFailedRetry'));
        setSaving(false);
      });
  };

  const removeTemplate = (id: string) => {
    askConfirm({
      title: t('templates.confirmDelete'),
      message: t('templates.deleteWarning'),
      confirmText: t('templates.delete'),
      danger: true,
      action: () => {
        apiFetch(`/api/templates/${id}`, { method: 'DELETE' })
          .then(res => {
            if (!res.ok) {
              toast.error(t('templates.deleteFailed', { status: res.status }));

              return;
            }
            navigate(viewPath('templates', null, route.q), { replace: true });
            refreshTemplates();
          })
          .catch(() => {
            toast.error(t('templates.deleteFailedRetry'));
          });
      },
    });
  };

  // 导入 .eml：主题作名称、正文取 HTML；要覆盖已有内容时先确认
  const importTemplateFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.eml')) {
      toast.error(t('templates.emlOnly'));

      return;
    }
    parseTemplateFile(file, t)
      .then(({ name, bodyHtml }) => {
        const apply = () =>
          setEditing(current =>
            current
              ? { ...current, name: name || current.name, body_html: bodyHtml }
              : current,
          );
        const hasContent = Boolean(
          editing?.name.trim() || editing?.body_html.trim(),
        );

        if (!hasContent) {
          apply();

          return;
        }
        askConfirm({
          title: name
            ? t('templates.importReplaceAll')
            : t('templates.importReplaceBody'),
          message: t('templates.importOverwrite'),
          confirmText: t('templates.replace'),
          danger: true,
          action: apply,
        });
      })
      .catch((error: Error) => {
        toast.error(error.message);
      });
  };

  return {
    templates,
    editing,
    setEditing,
    saving,
    openTemplate,
    saveTemplate,
    removeTemplate,
    importTemplateFile,
  };
}
