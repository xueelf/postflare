import { useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import { apiFetch } from '#/client/api';
import { useToast } from '#/client/components/toast';
import { type MessageKey, useI18n } from '#/client/i18n';
import { compileInky } from '#/client/inky';
import { type MailRoute, viewPath } from '#/client/route';
import { MAX_SUBJECT_LENGTH, MAX_TEMPLATE_BYTES } from '#/limits';

import type { ConfirmRequest } from './use-confirm';

export interface Template {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_source: string;
  updated_at: string;
}

export interface TemplateDeps {
  navigate: NavigateFunction;
  closeDrawer: () => void;
  askConfirm: (request: ConfirmRequest) => void;
  deleteTemplate: (id: string) => Promise<Response | null>;
}

interface MessageTemplateSource {
  subject: string;
  body_html: string | null;
  body_source: string | null;
}

// 服务端错误码 → 文案键
const TEMPLATE_ERRORS: Record<string, MessageKey> = {
  'attachment not found': 'templates.attachmentMissing',
  'subject too long': 'compose.errorSubjectTooLong',
  'template too large': 'templates.tooLarge',
};

function templateName(file: File): string {
  return file.name.replace(/\.inky$/i, '').trim();
}

function templatePayload(
  name: string,
  subject: string,
  bodyHtml: string,
  bodySource: string,
): string {
  return JSON.stringify({
    name,
    subject,
    body_html: bodyHtml,
    body_source: bodySource,
  });
}

/**
 * 模板列表、导入、另存为与删除。模板编辑窗口使用自己的 Hook。
 */
export function useTemplates(
  route: MailRoute,
  ready: boolean,
  deps: TemplateDeps,
) {
  const { navigate, closeDrawer, askConfirm, deleteTemplate } = deps;

  const [templates, setTemplates] = useState<Template[]>([]);
  const toast = useToast();
  const { t } = useI18n();
  const disposedRef = useRef(false);
  const abortRef = useRef(new AbortController());
  const routeRef = useRef(route);

  routeRef.current = route;

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      abortRef.current.abort();
    };
  }, []);

  const templateError = (error: string | undefined, status: number) => {
    const key = error ? TEMPLATE_ERRORS[error] : undefined;

    return key ? t(key) : t('templates.saveFailed', { status });
  };

  const refreshTemplates = () =>
    apiFetch('/api/templates')
      .then(async res => {
        if (!res.ok) {
          toast.error(t('common.loadFailed'));

          return;
        }
        const data = await res.json<Template[]>();

        if (!disposedRef.current) {
          setTemplates(data);
        }
      })
      .catch(() => {});

  useEffect(() => {
    if (ready) {
      refreshTemplates();
    }
  }, [ready]);

  const loadTemplate = async (file: File) => {
    if (file.size > MAX_TEMPLATE_BYTES) {
      throw new Error(t('templates.tooLarge'));
    }

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
        if (disposedRef.current) {
          return;
        }

        try {
          const { name, html } = await loadTemplate(file);

          if (disposedRef.current) {
            return;
          }
          const form = new FormData();

          form.append('file', file);
          form.append('name', name);
          form.append('body_html', html);

          const response = await apiFetch('/api/templates/import', {
            method: 'POST',
            body: form,
            signal: abortRef.current.signal,
          });

          if (disposedRef.current) {
            return;
          }

          if (!response.ok) {
            const data = (await response.json()) as { error?: string };

            throw new Error(templateError(data.error, response.status));
          }
          const data = (await response.json()) as { id: string };

          imported += 1;
          firstId ||= data.id;
        } catch (cause) {
          if (disposedRef.current) {
            return;
          }
          failed += 1;

          error =
            cause instanceof Error
              ? cause.message
              : t('templates.saveFailedRetry');
        }
      }

      if (disposedRef.current) {
        return;
      }

      if (imported === 0) {
        toast.error(error || t('templates.importFailed'));

        return;
      }

      await refreshTemplates();

      if (disposedRef.current) {
        return;
      }

      if (failed > 0) {
        toast.info(t('templates.importPartial', { imported, failed }));
      } else {
        toast.success(
          imported === 1
            ? t('templates.imported')
            : t('templates.importedCount', { count: imported }),
        );
      }

      if (disposedRef.current) {
        return;
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

    if (subject.length > MAX_SUBJECT_LENGTH) {
      toast.error(t('compose.errorSubjectTooLong'));

      return;
    }

    (async () => {
      if (disposedRef.current) {
        return;
      }

      const response = await apiFetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: templatePayload(
          subject || t('templates.untitled'),
          subject,
          body,
          source,
        ),
        signal: abortRef.current.signal,
      });

      if (disposedRef.current) {
        return;
      }

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };

        throw new Error(templateError(data.error, response.status));
      }
      await refreshTemplates();

      if (!disposedRef.current) {
        toast.success(t('templates.saved'));
      }
    })().catch((error: Error) => {
      if (!disposedRef.current) {
        toast.error(error.message);
      }
    });
  };

  const removeTemplate = (id: string) => {
    askConfirm({
      title: t('templates.confirmDelete'),
      message: t('templates.deleteWarning'),
      confirmText: t('templates.delete'),
      danger: true,
      action: () => {
        if (disposedRef.current) {
          return;
        }
        const context = routeRef.current;

        deleteTemplate(id)
          .then(res => {
            if (disposedRef.current) {
              return;
            }

            if (!res) {
              toast.error(t('compose.editingElsewhere'));

              return;
            }

            if (!res.ok) {
              toast.error(t('templates.deleteFailed', { status: res.status }));

              return;
            }
            toast.success(t('templates.deleted'));

            const current = routeRef.current;

            if (
              current.view === 'templates' &&
              current.q === context.q &&
              current.messageId === context.messageId
            ) {
              navigate(viewPath('templates', null, current.q), {
                replace: true,
              });
            }
            refreshTemplates();
          })
          .catch(() => {
            if (!disposedRef.current) {
              toast.error(t('templates.deleteFailedRetry'));
            }
          });
      },
    });
  };

  return {
    templates,
    refreshTemplates,
    importTemplates,
    saveMessageAsTemplate,
    removeTemplate,
  };
}
