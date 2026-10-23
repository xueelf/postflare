import { useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import { apiFetch } from '#/client/api';
import { useToast } from '#/client/components/toast';
import { readAsDataUrl } from '#/client/format';
import { useI18n } from '#/client/i18n';
import { compileInky } from '#/client/inky';
import { type MailRoute, viewPath } from '#/client/route';

import type { ConfirmRequest } from './use-confirm';

export interface Template {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_source: string;
  updated_at: string;
}

export interface TemplateDraft {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_source: string;
}

export interface TemplateDeps {
  navigate: NavigateFunction;
  closeDrawer: () => void;
  askConfirm: (request: ConfirmRequest) => void;
}

interface MessageTemplateSource {
  subject: string;
  body_html: string | null;
  body_source: string | null;
}

const ATTACHMENT_URL_RE = /\/api\/attachments\/([\w-]+)/g;

function templateName(file: File): string {
  return file.name.replace(/\.inky$/i, '').trim();
}

function draftOf(template: Template): TemplateDraft {
  return {
    id: template.id,
    name: template.name,
    subject: template.subject,
    body_html: template.body_html,
    body_source: template.body_source,
  };
}

/**
 * 模板：列表、导入、另存为、编辑与删除。
 * 新建模板由 .inky 导入或阅读器另存为产生，不再提供空白模板弹窗。
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

  // 模板弹窗由片段驱动，编辑哪一份留在状态里，刷新时回落到路由上打开的那份
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
        return null;
      }
      const found = templates.find(item => item.id === route.messageId);

      if (found) {
        return draftOf(found);
      }
      // 列表还没到就再等一轮
      return loaded ? null : current;
    });
  }, [ready, loaded, route.template, route.messageId, templates]);

  const openTemplate = (id: string) => {
    closeDrawer();

    const found = templates.find(item => item.id === id);

    if (!found) {
      return;
    }
    setEditing(draftOf(found));
    navigate(`${route.path}#template`, { state: { pfTemplate: true } });
  };

  // 另存为模板时把消息内联图片复制成模板自己的图片，避免原邮件删除后裂图
  const inlineAttachmentImages = async (htmls: string[]): Promise<string[]> => {
    const ids = [
      ...new Set(
        htmls.flatMap(html =>
          [...html.matchAll(ATTACHMENT_URL_RE)]
            .map(match => match[1])
            .filter((id): id is string => Boolean(id)),
        ),
      ),
    ];

    if (ids.length === 0) {
      return htmls;
    }
    const replacements = new Map<string, string>();

    for (const id of ids) {
      const response = await apiFetch(`/api/attachments/${id}`);

      if (!response.ok) {
        throw new Error(t('templates.saveFailedRetry'));
      }
      replacements.set(id, await readAsDataUrl(await response.blob()));
    }
    return htmls.map(html =>
      html.replace(
        ATTACHMENT_URL_RE,
        (match, id: string) => replacements.get(id) ?? match,
      ),
    );
  };

  const loadTemplate = async (file: File) => {
    const source = await file.text();

    return {
      name: templateName(file) || t('templates.untitled'),
      source,
      html: (await compileInky(source)).html,
    };
  };

  const importTemplates = (files: File[]) => {
    closeDrawer();

    (async () => {
      let imported = 0;
      let failed = 0;
      let firstId = '';
      let error = '';

      for (const file of files) {
        try {
          const { name, html } = await loadTemplate(file);
          const form = new FormData();

          form.append('file', file);
          form.append('name', name);
          form.append('body_html', html);

          const response = await apiFetch('/api/templates/import', {
            method: 'POST',
            body: form,
          });

          if (!response.ok) {
            const data = (await response.json()) as { error?: string };

            throw new Error(
              data.error ??
                t('templates.saveFailed', { status: response.status }),
            );
          }
          const data = (await response.json()) as { id: string };

          imported += 1;
          firstId ||= data.id;
        } catch (cause) {
          failed += 1;

          error =
            cause instanceof Error
              ? cause.message
              : t('templates.saveFailedRetry');
        }
      }

      if (imported === 0) {
        toast.error(error || t('templates.importFailed'));

        return;
      }

      await refreshTemplates();

      if (failed > 0) {
        toast.info(t('templates.importPartial', { imported, failed }));
      } else {
        toast.success(
          imported === 1
            ? t('templates.imported')
            : t('templates.importedCount', { count: imported }),
        );
      }
      navigate(`/templates/${firstId}`);
    })();
  };

  const saveMessageAsTemplate = (message: MessageTemplateSource) => {
    const subject = message.subject.trim();
    const body = message.body_html;
    const source = message.body_source;

    if (!body || !source) {
      toast.error(t('templates.noBody'));

      return;
    }
    inlineAttachmentImages([body, source])
      .then(async ([html = '', sourceHtml = '']) => {
        const response = await apiFetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: subject || t('templates.untitled'),
            subject,
            body_html: html,
            body_source: sourceHtml,
          }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };

          throw new Error(
            data.error ??
              t('templates.saveFailed', { status: response.status }),
          );
        }
        await refreshTemplates();
        toast.success(t('templates.saved'));
      })
      .catch((error: Error) => {
        toast.error(error.message);
      });
  };

  const saveTemplate = () => {
    if (!editing) {
      return;
    }
    setSaving(true);

    const run = (async () => {
      const html = (await compileInky(editing.body_source)).html;
      const res = await apiFetch(`/api/templates/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.name,
          subject: editing.subject,
          body_html: html,
          body_source: editing.body_source,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };

        toast.error(
          data.error ?? t('templates.saveFailed', { status: res.status }),
        );
        setSaving(false);

        return;
      }
      toast.success(t('templates.saved'));
      setSaving(false);
      navigate(route.path, { replace: true });
      refreshTemplates();
    })();

    run.catch(() => {
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
            toast.success(t('templates.deleted'));
            navigate(viewPath('templates', null, route.q), { replace: true });
            refreshTemplates();
          })
          .catch(() => {
            toast.error(t('templates.deleteFailedRetry'));
          });
      },
    });
  };

  // 编辑已有模板时用 .inky 源码覆盖正文
  const importTemplateFile = (file: File) => {
    loadTemplate(file)
      .then(({ name, source, html }) => {
        const apply = () =>
          setEditing(current =>
            current
              ? {
                  ...current,
                  name: name || current.name,
                  body_html: html,
                  body_source: source,
                }
              : current,
          );
        const hasContent = Boolean(
          editing?.name.trim() || editing?.body_source.trim(),
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
    importTemplates,
    saveMessageAsTemplate,
    saveTemplate,
    removeTemplate,
    importTemplateFile,
  };
}
