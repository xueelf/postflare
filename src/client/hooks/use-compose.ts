import { useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router';

import { apiFetch, IMAGE_MAX_BYTES } from '../api';
import { useToast } from '../components/toast';
import { dateTimeValue, formatTime, textToHtml } from '../format';
import { useI18n } from '../i18n';
import { type MailRoute, viewPath } from '../route';

import type { MessageDetail } from './use-messages';

const AUTOSAVE_DELAY = 2000;

interface ComposeSnapshot {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface ComposeDeps {
  navigate: NavigateFunction;
  closeDrawer: () => void;
  openMessage: MessageDetail | null;
  refreshList: () => void;
}

/**
 * 写信弹窗：内容状态、草稿自动保存、发送与正文图片上传。
 */
export function useCompose(route: MailRoute, deps: ComposeDeps) {
  const { navigate, closeDrawer, openMessage, refreshList } = deps;
  const { locale, t } = useI18n();

  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeText, setComposeText] = useState('');
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
  const draftSaveRef = useRef<Promise<string | null> | null>(null);
  const loadedDraftRef = useRef<string | null>(null);

  // 「已保存」由当前内容与保存时的快照比较得出，改回原样即恢复
  const draftSaved =
    savedCompose !== null &&
    composeTo === savedCompose.to &&
    composeSubject === savedCompose.subject &&
    composeText === savedCompose.text &&
    composeHtml === savedCompose.html;

  const composeEmpty =
    !composeTo.trim() &&
    !composeSubject.trim() &&
    !composeText.trim() &&
    !composeHtml.includes('<img');

  // 底部状态：保存失败 / 正在保存 / 已保存（含时间）
  let composeStatus = '';

  if (draftError) {
    composeStatus = t('compose.saveFailed');
  } else if (draftBusy || (!draftSaved && !composeEmpty)) {
    composeStatus = t('compose.saving');
  } else if (draftSaved) {
    composeStatus = t('compose.saved', { time: savedAt });
  }

  const resetCompose = () => {
    setComposeTo('');
    setComposeSubject('');
    setComposeText('');
    setComposeHtml('');
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

    const draftHtml =
      openMessage.body_html ?? textToHtml(openMessage.body_text ?? '');

    setDraftId(openMessage.id);
    setComposeTo(openMessage.to_address);
    setComposeSubject(openMessage.subject);
    setComposeText(openMessage.body_text ?? '');
    setComposeHtml(draftHtml);

    setSavedCompose({
      to: openMessage.to_address,
      subject: openMessage.subject,
      text: openMessage.body_text ?? '',
      html: draftHtml,
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

  const saveDraft = (htmlOverride?: string): Promise<string | null> => {
    // 已有保存在进行中时直接复用它，避免并发保存拿不到草稿 id
    if (draftSaveRef.current) {
      return draftSaveRef.current;
    }
    const snapshot = {
      to: composeTo,
      subject: composeSubject,
      text: composeText,
      html: htmlOverride ?? composeHtml,
    };

    setDraftBusy(true);
    setDraftError('');

    draftSaveRef.current = apiFetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draftId, ...snapshot }),
    })
      .then(async res => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };

          setDraftError(data.error ?? t('compose.saveFailed'));
          setDraftBusy(false);

          return null;
        }
        const data = (await res.json()) as { id: string };

        setDraftId(data.id);
        setSavedCompose(snapshot);
        setSavedAt(formatTime(new Date(), locale));
        setDraftBusy(false);
        refreshList();

        return data.id;
      })
      .catch(() => {
        setDraftError(t('compose.saveFailed'));
        setDraftBusy(false);

        return null;
      })
      .finally(() => {
        draftSaveRef.current = null;
      });

    return draftSaveRef.current;
  };

  // 正文内联图片：先确保草稿存在，再上传到 R2 并返回应用地址
  const uploadImage = async (file: File, html: string): Promise<string> => {
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error(t('compose.imageTooLarge'));

      throw new Error('file too large');
    }
    let id = draftId;

    if (!id) {
      id = await saveDraft(html);
    }

    if (!id) {
      toast.error(t('compose.imageUploadFailed'));

      throw new Error('draft not saved');
    }
    const form = new FormData();

    form.append('file', file);
    form.append('messageId', id);

    const res = await apiFetch('/api/attachments', {
      method: 'POST',
      body: form,
    }).catch(() => null);

    if (!res || !res.ok) {
      toast.error(t('compose.imageUploadFailed'));

      throw new Error('upload failed');
    }
    const data = (await res.json()) as { id: string };

    return `/api/attachments/${data.id}`;
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

  // 自动保存：输入停止后保存草稿（html 与 text 同源，html 是超集信号）
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
    composeHtml,
  ]);

  const sendCompose = () => {
    setComposeBusy(true);

    apiFetch('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: composeTo,
        subject: composeSubject,
        text: composeText,
        html: composeHtml,
        draftId: draftId ?? undefined,
      }),
    })
      .then(async res => {
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };

          toast.error(
            data.error ?? t('compose.sendFailedStatus', { status: res.status }),
          );
          setComposeBusy(false);

          return;
        }
        const data = (await res.json()) as { id: string };

        toast.success(t('compose.sent'));
        resetCompose();
        setComposeBusy(false);
        refreshList();
        navigate(`/sent/${data.id}`);
      })
      .catch(() => {
        toast.error(t('compose.sendFailed'));
        setComposeBusy(false);
      });
  };

  return {
    composing: route.compose,
    composeTo,
    setComposeTo,
    composeSubject,
    setComposeSubject,
    composeText,
    setComposeText,
    composeHtml,
    setComposeHtml,
    composeBusy,
    composeStatus,
    openCompose,
    resetCompose,
    flushDraft,
    uploadImage,
    sendCompose,
  };
}
