import { useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import { apiFetch } from '#/client/api';
import { useToast } from '#/client/components/toast';
import { dateTimeValue, formatTime } from '#/client/format';
import { type MessageKey, useI18n } from '#/client/i18n';
import { compileInky } from '#/client/inky';
import { type MailRoute, viewPath } from '#/client/route';

import type { MessageDetail } from './use-messages';

const AUTOSAVE_DELAY = 2000;

// 服务端错误码 → 文案键
const COMPOSE_ERRORS: Record<string, MessageKey> = {
  'invalid recipient': 'compose.errorRecipient',
  'too many recipients': 'compose.errorTooManyRecipients',
  'message text is empty': 'compose.errorEmpty',
  'message source is empty': 'compose.errorEmpty',
  'draft is empty': 'compose.errorDraftEmpty',
  'message too large': 'compose.errorTooLarge',
  'subject too long': 'compose.errorSubjectTooLong',
};

interface ComposeSnapshot {
  to: string;
  subject: string;
  text: string;
  source: string;
}

export interface ComposeDeps {
  navigate: NavigateFunction;
  closeDrawer: () => void;
  openMessage: MessageDetail | null;
  refreshList: () => void;
  refreshCounts: () => void;
}

/**
 * 写信弹窗：内容状态、草稿自动保存与发送。
 */
export function useCompose(route: MailRoute, deps: ComposeDeps) {
  const { navigate, closeDrawer, openMessage, refreshList, refreshCounts } =
    deps;
  const { locale, t } = useI18n();

  // 已知的服务端错误按码翻译，其余用统一失败文案
  const composeError = (error: string | undefined, fallback: MessageKey) =>
    t(COMPOSE_ERRORS[error ?? ''] ?? fallback);

  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeText, setComposeText] = useState('');
  const [composeSource, setComposeSource] = useState('');
  const [composeHtml, setComposeHtml] = useState('');
  const [composeBusy, setComposeBusy] = useState(false);
  const toast = useToast();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [savedCompose, setSavedCompose] = useState<ComposeSnapshot | null>(
    null,
  );
  const [savedAt, setSavedAt] = useState('');
  const [draftError, setDraftError] = useState('');
  const contentRef = useRef({ source: '', text: '', html: '' });
  const draftSaveRef = useRef<Promise<string | null> | null>(null);
  const loadedDraftRef = useRef<string | null>(null);

  // 「已保存」由当前内容与保存时的快照比较得出，改回原样即恢复
  const draftSaved =
    savedCompose !== null &&
    composeTo === savedCompose.to &&
    composeSubject === savedCompose.subject &&
    composeText === savedCompose.text &&
    composeSource === savedCompose.source;

  const composeEmpty =
    !composeTo.trim() &&
    !composeSubject.trim() &&
    !composeText.trim() &&
    !composeSource.includes('<image') &&
    !composeSource.includes('<img') &&
    !composeHtml.includes('<img');

  // 底部状态：保存失败 / 正在保存 / 已保存（含时间）
  let composeStatus = '';

  if (draftError) {
    composeStatus = draftError;
  } else if (draftBusy || (!draftSaved && !composeEmpty)) {
    composeStatus = t('compose.saving');
  } else if (draftSaved) {
    composeStatus = t('compose.saved', { time: savedAt });
  }

  const resetCompose = () => {
    setComposeTo('');
    setComposeSubject('');
    setComposeText('');
    setComposeSource('');
    setComposeHtml('');

    contentRef.current = { source: '', text: '', html: '' };
    setDraftId(null);
    setSavedCompose(null);
    setSavedAt('');
    setDraftError('');
    loadedDraftRef.current = null;
  };

  // 编辑草稿：路由打开 #compose 且邮件载入后回填一次
  useEffect(() => {
    if (
      !route.compose ||
      route.view !== 'drafts' ||
      !openMessage ||
      loadedDraftRef.current === openMessage.id
    ) {
      return;
    }

    loadedDraftRef.current = openMessage.id;

    const draftSource = openMessage.body_source ?? '';
    const draftHtml = openMessage.body_html ?? '';

    setDraftId(openMessage.id);
    setComposeTo(openMessage.to_address);
    setComposeSubject(openMessage.subject);
    setComposeText(openMessage.body_text ?? '');
    setComposeSource(draftSource);
    setComposeHtml(draftHtml);

    contentRef.current = {
      source: draftSource,
      text: openMessage.body_text ?? '',
      html: draftHtml,
    };

    setSavedCompose({
      to: openMessage.to_address,
      subject: openMessage.subject,
      text: openMessage.body_text ?? '',
      source: draftSource,
    });

    setSavedAt(
      formatTime(new Date(dateTimeValue(openMessage.updated_at)), locale),
    );
  }, [route.compose, route.view, openMessage]);

  // 关闭写信弹窗时清空编辑状态
  useEffect(() => {
    if (!route.compose) {
      resetCompose();
    }
  }, [route.compose]);

  const openCompose = (to = '') => {
    resetCompose();
    setComposeTo(to);
    closeDrawer();

    navigate(`${viewPath(route.view, route.messageId, route.q)}#compose`, {
      state: { pfCompose: true },
    });
  };

  const updateComposeContent = (content: {
    source: string;
    text: string;
    html: string;
  }) => {
    contentRef.current = content;
    setComposeSource(content.source);
    setComposeText(content.text);
    setComposeHtml(content.html);
  };

  const saveDraft = (): Promise<string | null> => {
    // 已有保存在进行中时直接复用它，避免并发保存拿不到草稿 id
    if (draftSaveRef.current) {
      return draftSaveRef.current;
    }
    const content = contentRef.current;
    const snapshot: ComposeSnapshot = {
      to: composeTo,
      subject: composeSubject,
      text: content.text,
      source: content.source,
    };

    setDraftBusy(true);
    setDraftError('');

    const run = (async () => {
      let html = content.html;

      if (content.source.trim()) {
        html = (await compileInky(content.source)).html;
      }

      const res = await apiFetch(
        draftId ? `/api/drafts/${draftId}` : '/api/drafts',
        {
          method: draftId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: snapshot.to,
            subject: snapshot.subject,
            text: snapshot.text,
            source: snapshot.source,
            html,
          }),
        },
      );

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };

        setDraftError(composeError(data.error, 'compose.saveFailed'));
        setDraftBusy(false);

        return null;
      }
      const data = (await res.json()) as { id: string };

      setDraftId(data.id);
      setSavedCompose(snapshot);
      setSavedAt(formatTime(new Date(), locale));
      setDraftBusy(false);
      refreshList();
      refreshCounts();

      return data.id;
    })()
      .catch(() => {
        setDraftError(t('compose.saveFailed'));
        setDraftBusy(false);

        return null;
      })
      .finally(() => {
        draftSaveRef.current = null;
      });

    draftSaveRef.current = run;

    return run;
  };

  // 关闭写信前把未保存的内容立即落草稿
  const flushDraft = () => {
    if (draftSaved || draftBusy || composeEmpty) {
      return;
    }
    saveDraft();
  };

  // 定时器只负责计时，保存用 ref 取最新实现，避免闭包拿到旧的草稿 id
  const saveDraftRef = useRef(saveDraft);

  saveDraftRef.current = saveDraft;

  // 自动保存：输入停止后保存草稿（源码是最终内容，编译结果只用于展示）
  useEffect(() => {
    if (!route.compose || composeBusy || draftSaved || composeEmpty) {
      return;
    }
    const timer = setTimeout(() => saveDraftRef.current(), AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [
    route.compose,
    composeBusy,
    draftSaved,
    draftBusy,
    composeEmpty,
    composeTo,
    composeSubject,
    composeSource,
  ]);

  const sendCompose = async () => {
    setComposeBusy(true);

    try {
      if (!composeSource.trim()) {
        toast.error(t('compose.errorEmpty'));
        setComposeBusy(false);

        return;
      }
      const compiled = await compileInky(composeSource);
      const html = compiled.html;
      const text = compiled.text;

      const res = await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          text,
          source: composeSource,
          html,
          draftId: draftId ?? undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };

        toast.error(composeError(data.error, 'compose.sendFailed'));
        setComposeBusy(false);

        return;
      }
      const data = (await res.json()) as { id: string };

      toast.success(t('compose.sent'));
      resetCompose();
      setComposeBusy(false);
      refreshList();
      refreshCounts();
      navigate(`/sent/${data.id}`);
    } catch {
      toast.error(t('compose.sendFailed'));
      setComposeBusy(false);
    }
  };

  return {
    composing: route.compose,
    composeTo,
    setComposeTo,
    composeSubject,
    setComposeSubject,
    composeText,
    composeSource,
    composeHtml,
    composeBusy,
    composeStatus,
    openCompose,
    resetCompose,
    flushDraft,
    updateComposeContent,
    sendCompose,
  };
}
