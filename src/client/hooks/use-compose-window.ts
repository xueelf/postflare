import { useEffect, useRef, useState } from 'react';

import {
  extractAttachmentIds,
  hasUnreferencedAttachments,
} from '#/attachment-url';
import { apiFetch } from '#/client/api';
import { useToast } from '#/client/components/toast';
import { dateTimeValue, formatTime } from '#/client/format';
import { type MessageKey, useI18n } from '#/client/i18n';
import { compileInky } from '#/client/inky';
import { draftLockName } from '#/client/locks';
import { AttachmentUploadError, uploadAttachment } from '#/client/upload';
import { MAX_IMAGE_BYTES, MAX_RECIPIENTS, MAX_SUBJECT_LENGTH } from '#/limits';
import { parseRecipients, validRecipients } from '#/recipients';

import type { MessageDetail } from './use-messages';

const AUTOSAVE_DELAY = 2000;

const COMPOSE_ERRORS: Record<string, MessageKey> = {
  'invalid recipient': 'compose.errorRecipient',
  'too many recipients': 'compose.errorTooManyRecipients',
  'message source is empty': 'compose.errorEmpty',
  'draft is empty': 'compose.errorDraftEmpty',
  'message too large': 'compose.errorTooLarge',
  'subject too long': 'compose.errorSubjectTooLong',
  'read only': 'compose.editingElsewhere',
};

interface Snapshot {
  to: string;
  subject: string;
  source: string;
}

interface PersistOptions {
  allowEmpty?: boolean;
  prune?: boolean;
}

type PersistResult =
  | { ok: true; id: string; message: MessageDetail | null }
  | { ok: false; error: string; missing?: boolean };

export interface ComposeWindowDeps {
  userId: string;
  windowId: string;
  initialDraftId: string | null;
  initialTo: string;
  onDraftId: (windowId: string, draftId: string) => void;
  onClose: (windowId: string) => void;
  refreshList: () => void;
  refreshCounts: () => void;
  syncOpenMessage: (message: MessageDetail) => void;
}

/**
 * 单个写信窗口：内容、自动保存、上传、发送和终结操作。
 * 实例生命周期与窗口一致，不随路由变化。
 */
export function useComposeWindow(deps: ComposeWindowDeps) {
  const {
    userId,
    windowId,
    initialDraftId,
    initialTo,
    onDraftId,
    onClose,
    refreshList,
    refreshCounts,
    syncOpenMessage,
  } = deps;
  const { locale, t } = useI18n();
  const toast = useToast();
  const composeError = (error: string | undefined, fallback: MessageKey) =>
    t(COMPOSE_ERRORS[error ?? ''] ?? fallback);

  const [to, setToState] = useState(initialTo);
  const [subject, setSubjectState] = useState('');
  const [source, setSourceState] = useState('');
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [savedAt, setSavedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sending, setSending] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [uploading, setUploadingState] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(initialDraftId));
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(!initialDraftId);
  const [readOnly, setReadOnly] = useState(false);
  const [missing, setMissing] = useState(false);
  const missingRef = useRef(false);
  const loadedRef = useRef(!initialDraftId);
  const toRef = useRef(initialTo);
  const initialDraftIdRef = useRef(initialDraftId);
  const subjectRef = useRef('');
  const sourceRef = useRef('');
  const draftIdRef = useRef(initialDraftId);
  const savedSnapshotRef = useRef<Snapshot | null>(null);
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeSavesRef = useRef(0);
  const closingRef = useRef(false);
  const sendingRef = useRef(false);
  const discardingRef = useRef(false);
  const disposedRef = useRef(false);
  const abortRef = useRef(new AbortController());
  const uploadingRef = useRef(false);
  const uploadWaitersRef = useRef<Array<() => void>>([]);
  const uploadQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const knownAttachmentIdsRef = useRef<string[]>([]);
  const releaseLockRef = useRef<(() => void) | null>(null);
  const lockAttemptRef = useRef(0);
  const readOnlyRef = useRef(false);

  const markReadOnly = (value: boolean) => {
    readOnlyRef.current = value;
    setReadOnly(value);
  };

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      lockAttemptRef.current += 1;
      abortRef.current.abort();
      releaseLockRef.current?.();
    };
  }, []);

  const snapshotOf = (): Snapshot => ({
    to: toRef.current,
    subject: subjectRef.current,
    source: sourceRef.current,
  });

  const sameSnapshot = (left: Snapshot | null, right: Snapshot) =>
    left !== null &&
    left.to === right.to &&
    left.subject === right.subject &&
    left.source === right.source;

  const isEmptySnapshot = (snapshot: Snapshot) =>
    !snapshot.to.trim() && !snapshot.subject.trim() && !snapshot.source.trim();

  const hasLocalChanges = () => {
    const snapshot = snapshotOf();

    return savedSnapshotRef.current
      ? !sameSnapshot(savedSnapshotRef.current, snapshot)
      : !isEmptySnapshot(snapshot);
  };

  const setUploading = (value: boolean) => {
    uploadingRef.current = value;
    setUploadingState(value);

    if (!value) {
      const waiters = uploadWaitersRef.current;

      uploadWaitersRef.current = [];
      waiters.forEach(resolve => resolve());
    }
  };

  const waitForUploads = async () => {
    while (uploadingRef.current) {
      await new Promise<void>(resolve => {
        uploadWaitersRef.current.push(resolve);
      });
    }
  };

  const setTo = (value: string) => {
    toRef.current = value;
    setToState(value);
  };

  const setSubject = (value: string) => {
    subjectRef.current = value;
    setSubjectState(value);
  };

  const updateSource = (value: string) => {
    sourceRef.current = value;
    setSourceState(value);
  };

  const acquireLock = (draftId: string): Promise<boolean> => {
    releaseLockRef.current?.();
    releaseLockRef.current = null;

    const attempt = (lockAttemptRef.current += 1);

    if (typeof navigator === 'undefined' || !navigator.locks) {
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      let settled = false;

      navigator.locks
        .request(
          draftLockName(userId, draftId),
          { ifAvailable: true },
          async lock => {
            if (!lock) {
              if (!settled) {
                settled = true;
                resolve(false);
              }
              return;
            }

            if (disposedRef.current || attempt !== lockAttemptRef.current) {
              if (!settled) {
                settled = true;
                resolve(false);
              }
              return;
            }

            if (!settled) {
              settled = true;
              resolve(true);
            }
            await new Promise<void>(release => {
              releaseLockRef.current = release;
            });
          },
        )
        .catch(() => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        });
    });
  };

  const applyDetail = (detail: MessageDetail) => {
    const draftSource = detail.body_source ?? '';

    loadedRef.current = true;
    setLoaded(true);
    setLoadFailed(false);
    draftIdRef.current = detail.id;
    knownAttachmentIdsRef.current = extractAttachmentIds(draftSource);

    setTo(detail.to_address);
    setSubject(detail.subject);
    setSourceState(draftSource);
    sourceRef.current = draftSource;

    const snapshot = {
      to: detail.to_address,
      subject: detail.subject,
      source: draftSource,
    };

    savedSnapshotRef.current = snapshot;
    setSaved(snapshot);
    setSavedAt(formatTime(new Date(dateTimeValue(detail.updated_at)), locale));
  };

  const loadDraft = async (draftId: string) => {
    setLoading(true);
    setLoadFailed(false);
    setError('');

    try {
      const res = await apiFetch(`/api/messages/${draftId}`, {
        signal: abortRef.current.signal,
      });

      if (disposedRef.current) {
        return;
      }

      if (res.status === 404) {
        missingRef.current = true;
        setMissing(true);
        setError(t('compose.draftDeleted'));

        return;
      }

      if (!res.ok) {
        setLoadFailed(true);
        setError(t('common.loadFailed'));

        return;
      }
      applyDetail((await res.json()) as MessageDetail);
    } catch {
      if (!disposedRef.current) {
        setLoadFailed(true);
        setError(t('common.loadFailed'));
      }
    } finally {
      if (!disposedRef.current) {
        setLoading(false);
      }
    }
  };

  const retryLoad = async () => {
    if (!draftIdRef.current || loading) {
      return;
    }
    await loadDraft(draftIdRef.current);
  };

  useEffect(() => {
    const draftId = initialDraftIdRef.current;

    if (!draftId) {
      return;
    }

    let cancelled = false;

    (async () => {
      const locked = await acquireLock(draftId);

      if (cancelled || disposedRef.current) {
        return;
      }
      markReadOnly(!locked);
      await loadDraft(draftId);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const retryLock = async () => {
    if (!draftIdRef.current) {
      return;
    }
    const locked = await acquireLock(draftIdRef.current);

    if (disposedRef.current) {
      return;
    }
    markReadOnly(!locked);

    // 本地有未保存内容时不能直接用服务端版本覆盖
    if (locked && !hasLocalChanges()) {
      await loadDraft(draftIdRef.current);
    }
  };

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = writeChainRef.current.then(task);

    writeChainRef.current = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  };

  const persist = async (
    snapshot: Snapshot,
    options: PersistOptions,
  ): Promise<PersistResult> => {
    if (disposedRef.current) {
      return { ok: false, error: 'disposed' };
    }

    const id = draftIdRef.current;

    let html = '';
    let text = '';

    if (snapshot.source.trim()) {
      const compiled = await compileInky(snapshot.source);

      html = compiled.html;
      text = compiled.text;
    }

    if (disposedRef.current) {
      return { ok: false, error: 'disposed' };
    }

    // 等待编译期间可能已失去编辑权，提交前按当前状态重新检查
    if (readOnlyRef.current) {
      return { ok: false, error: 'read only' };
    }

    const res = await apiFetch(id ? `/api/drafts/${id}` : '/api/drafts', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortRef.current.signal,
      body: JSON.stringify({
        to: snapshot.to,
        subject: snapshot.subject,
        text,
        source: snapshot.source,
        html,
        allowEmpty: options.allowEmpty || undefined,
        prune: options.prune || undefined,
        pruneIds: options.prune ? knownAttachmentIdsRef.current : undefined,
      }),
    });

    if (res.status === 404) {
      return { ok: false, error: 'draft deleted', missing: true };
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      return { ok: false, error: data.error ?? 'save failed' };
    }
    const data = (await res.json()) as {
      id: string;
      message?: MessageDetail | null;
    };

    if (options.prune) {
      knownAttachmentIdsRef.current = extractAttachmentIds(snapshot.source);
    }

    if (!id) {
      draftIdRef.current = data.id;
      onDraftId(windowId, data.id);

      const locked = await acquireLock(data.id);

      if (!locked && !disposedRef.current) {
        markReadOnly(true);
      }
    }

    return { ok: true, id: data.id, message: data.message ?? null };
  };

  const applySaved = (snapshot: Snapshot, message: MessageDetail | null) => {
    savedSnapshotRef.current = snapshot;
    setSaved(snapshot);
    setSavedAt(formatTime(new Date(), locale));

    if (message) {
      syncOpenMessage(message);
    }
    refreshList();
    refreshCounts();
  };

  const saveDraft = (
    options?: PersistOptions,
    force = false,
  ): Promise<string | null> => {
    const snapshot = snapshotOf();

    if (draftIdRef.current && !loadedRef.current) {
      return Promise.resolve(null);
    }

    if (parseRecipients(snapshot.to).length > MAX_RECIPIENTS) {
      setError(t('compose.errorTooManyRecipients'));

      return Promise.resolve(null);
    }

    if (snapshot.subject.length > MAX_SUBJECT_LENGTH) {
      setError(t('compose.errorSubjectTooLong'));

      return Promise.resolve(null);
    }

    activeSavesRef.current += 1;
    setSaving(true);
    setError('');

    return enqueue(async () => {
      if (
        disposedRef.current ||
        readOnlyRef.current ||
        (missingRef.current && !force)
      ) {
        return null;
      }

      if (
        draftIdRef.current &&
        sameSnapshot(savedSnapshotRef.current, snapshot) &&
        !options?.prune
      ) {
        return draftIdRef.current;
      }

      let result: PersistResult;

      try {
        result = await persist(snapshot, options ?? {});
      } catch {
        result = { ok: false, error: 'save failed' };
      }

      if (disposedRef.current) {
        return null;
      }

      if (!result.ok) {
        if (result.missing) {
          missingRef.current = true;
          setMissing(true);
          setError(t('compose.draftDeleted'));
        } else {
          setError(composeError(result.error, 'compose.saveFailed'));
        }

        return null;
      }

      applySaved(snapshot, result.message);

      return result.id;
    }).finally(() => {
      activeSavesRef.current -= 1;

      if (activeSavesRef.current === 0) {
        setSaving(false);
      }
    });
  };

  const saveNow = async () => {
    if (
      readOnlyRef.current ||
      missing ||
      loading ||
      closingRef.current ||
      sendingRef.current ||
      discardingRef.current ||
      (draftIdRef.current && !loadedRef.current)
    ) {
      return;
    }
    const id = await saveDraft();

    if (id) {
      toast.success(
        t('compose.saved', { time: formatTime(new Date(), locale) }),
      );
    }
  };

  const saveAndClose = async (): Promise<boolean> => {
    if (closingRef.current || sendingRef.current || discardingRef.current) {
      return false;
    }

    closingRef.current = true;
    setClosing(true);

    try {
      if (readOnlyRef.current) {
        if (!hasLocalChanges()) {
          onClose(windowId);

          return true;
        }
        setError(t('compose.editingElsewhere'));

        return false;
      }

      if (draftIdRef.current && !loadedRef.current) {
        onClose(windowId);

        return true;
      }

      if (missingRef.current) {
        if (!hasLocalChanges()) {
          onClose(windowId);

          return true;
        }
        setError(t('compose.draftDeleted'));

        return false;
      }

      await waitForUploads();
      // 等待已接受的首次保存完成，再判断窗口是否真的从未创建过
      await enqueue(async () => {});

      if (disposedRef.current) {
        return false;
      }

      const snapshot = snapshotOf();

      if (!draftIdRef.current && isEmptySnapshot(snapshot)) {
        onClose(windowId);

        return true;
      }

      let result: PersistResult;

      try {
        result = await enqueue(() =>
          persist(snapshot, {
            allowEmpty: !draftIdRef.current,
            prune: true,
          }),
        );
      } catch {
        result = { ok: false, error: 'save failed' };
      }

      if (disposedRef.current) {
        return false;
      }

      if (!result.ok) {
        setError(
          result.missing
            ? t('compose.draftDeleted')
            : composeError(result.error, 'compose.saveFailed'),
        );

        if (result.missing) {
          missingRef.current = true;
          setMissing(true);
        }
        toast.error(t('compose.saveFailed'));

        return false;
      }

      applySaved(snapshot, result.message);
      onClose(windowId);

      return true;
    } finally {
      if (!disposedRef.current) {
        closingRef.current = false;
        setClosing(false);
      }
    }
  };

  const discardAndClose = async (): Promise<boolean> => {
    if (sendingRef.current || discardingRef.current) {
      return false;
    }

    discardingRef.current = true;
    setDiscarding(true);
    closingRef.current = true;
    setClosing(true);
    onClose(windowId);

    return true;
  };

  const send = async () => {
    if (
      loading ||
      sendingRef.current ||
      closingRef.current ||
      discardingRef.current ||
      readOnlyRef.current ||
      missing ||
      (draftIdRef.current && !loadedRef.current)
    ) {
      return;
    }

    sendingRef.current = true;
    setSending(true);

    try {
      await waitForUploads();
      await writeChainRef.current;

      if (disposedRef.current) {
        return;
      }

      const snapshot = snapshotOf();

      if (!snapshot.source.trim()) {
        toast.error(t('compose.errorEmpty'));

        return;
      }

      if (!validRecipients(snapshot.to)) {
        toast.error(t('compose.errorRecipient'));

        return;
      }

      if (parseRecipients(snapshot.to).length > MAX_RECIPIENTS) {
        toast.error(t('compose.errorTooManyRecipients'));

        return;
      }

      if (snapshot.subject.length > MAX_SUBJECT_LENGTH) {
        toast.error(t('compose.errorSubjectTooLong'));

        return;
      }

      const compiled = await compileInky(snapshot.source);

      if (disposedRef.current) {
        return;
      }

      // 等待保存和编译期间可能已失去编辑权，投递前按当前状态重新检查
      if (readOnlyRef.current) {
        toast.error(t('compose.editingElsewhere'));

        return;
      }

      const res = await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          to: snapshot.to,
          subject: snapshot.subject,
          text: compiled.text,
          source: snapshot.source,
          html: compiled.html,
          draftId: draftIdRef.current ?? undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };

        toast.error(composeError(data.error, 'compose.sendFailed'));

        return;
      }
      const data = (await res.json()) as { id: string; archived: boolean };

      if (disposedRef.current) {
        return;
      }

      if (data.archived) {
        toast.success(t('compose.sent'));
      } else {
        toast.info(t('compose.sentNotArchived'));
      }
      refreshList();
      refreshCounts();
      onClose(windowId);
    } catch {
      if (!disposedRef.current) {
        toast.error(t('compose.sendFailed'));
      }
    } finally {
      if (!disposedRef.current) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  const discard = async () => {
    if (discardingRef.current || sendingRef.current || closingRef.current) {
      return;
    }

    if (readOnlyRef.current || missingRef.current) {
      onClose(windowId);

      return;
    }

    discardingRef.current = true;
    setDiscarding(true);

    try {
      await waitForUploads();
      await writeChainRef.current;

      if (disposedRef.current) {
        return;
      }

      // 等待期间失去编辑权时只丢弃本地窗口，不删除其它标签页正在编辑的草稿
      if (readOnlyRef.current) {
        onClose(windowId);

        return;
      }

      const id = draftIdRef.current;

      if (id) {
        const res = await apiFetch(`/api/drafts/${id}`, {
          method: 'DELETE',
          signal: abortRef.current.signal,
        });

        if (disposedRef.current) {
          return;
        }

        if (!res.ok && res.status !== 404) {
          toast.error(t('mail.actionFailedRetry'));

          return;
        }
      }

      refreshList();
      refreshCounts();
      onClose(windowId);
    } catch {
      if (!disposedRef.current) {
        toast.error(t('mail.actionFailedRetry'));
      }
    } finally {
      if (!disposedRef.current) {
        discardingRef.current = false;
        setDiscarding(false);
      }
    }
  };

  const uploadImageNow = async (
    file: File,
    apply: (url: string) => boolean,
  ): Promise<void> => {
    if (
      disposedRef.current ||
      readOnlyRef.current ||
      sendingRef.current ||
      discardingRef.current
    ) {
      throw new Error('compose closed');
    }

    if (!file.type.startsWith('image/')) {
      toast.error(t('compose.imageUploadFailed'));

      throw new Error('unsupported image type');
    }

    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t('compose.imageTooLarge'));

      throw new Error('image too large');
    }

    if (!draftIdRef.current) {
      await saveDraft({ allowEmpty: true });
    }

    if (disposedRef.current || readOnlyRef.current || !draftIdRef.current) {
      toast.error(t('compose.saveFailed'));

      throw new Error('draft unavailable');
    }

    try {
      const snapshot = snapshotOf();
      const compiled = snapshot.source.trim()
        ? await compileInky(snapshot.source)
        : { text: '', html: '' };

      if (disposedRef.current) {
        return;
      }

      const url = await uploadAttachment(
        file,
        { messageId: draftIdRef.current },
        {
          text: compiled.text,
          html: compiled.html,
          subject: snapshot.subject,
        },
        extractAttachmentIds(sourceRef.current),
      );
      const uploaded = /\/api\/attachments\/([\w-]+)/.exec(url)?.[1];

      if (disposedRef.current) {
        return;
      }

      if (uploaded) {
        knownAttachmentIdsRef.current = [
          ...new Set([...knownAttachmentIdsRef.current, uploaded]),
        ];
      }
      apply(url);
    } catch (error) {
      toast.error(
        error instanceof AttachmentUploadError && error.tooLarge
          ? t('compose.imageTooLarge')
          : t('compose.imageUploadFailed'),
      );

      throw error;
    }
  };

  const uploadImage = (
    file: File,
    apply: (url: string) => boolean,
  ): Promise<void> => {
    if (
      disposedRef.current ||
      readOnlyRef.current ||
      closingRef.current ||
      sendingRef.current ||
      discardingRef.current
    ) {
      return Promise.reject(new Error('compose is busy'));
    }

    const run = uploadQueueRef.current.then(() => uploadImageNow(file, apply));

    uploadQueueRef.current = run.catch(() => {});

    return run;
  };

  const saveAsNew = async () => {
    if (disposedRef.current) {
      return;
    }
    draftIdRef.current = null;
    loadedRef.current = true;
    setLoaded(true);
    // 切换到新草稿身份时同步清空保存基线，创建失败后仍按未保存处理
    savedSnapshotRef.current = null;
    setSaved(null);
    setSavedAt('');
    missingRef.current = false;
    setMissing(false);
    // 新草稿身份不再受旧草稿锁限制，创建失败时保留本地内容继续重试
    markReadOnly(false);
    setError('');
    await saveDraft({ allowEmpty: true }, true);
  };

  useEffect(() => {
    if (
      readOnly ||
      missing ||
      loading ||
      loadFailed ||
      closing ||
      sending ||
      discarding ||
      (!draftIdRef.current &&
        !to.trim() &&
        !subject.trim() &&
        !source.trim()) ||
      sameSnapshot(saved, snapshotOf())
    ) {
      return;
    }

    const timer = setTimeout(() => {
      if (
        !sendingRef.current &&
        !closingRef.current &&
        !discardingRef.current
      ) {
        saveDraft().catch(() => {});
      }
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [
    readOnly,
    missing,
    loading,
    loadFailed,
    closing,
    sending,
    discarding,
    saved,
    to,
    subject,
    source,
  ]);

  const needsCleanup = hasUnreferencedAttachments(
    source,
    knownAttachmentIdsRef.current,
  );
  const empty = !to.trim() && !subject.trim() && !source.trim();
  const dirty = saved ? !sameSnapshot(saved, snapshotOf()) : !empty;

  const saveForLogout = async (): Promise<boolean> => {
    if (loading) {
      return true;
    }

    if (readOnlyRef.current) {
      return !hasLocalChanges();
    }

    if (draftIdRef.current && !loadedRef.current) {
      return true;
    }

    await waitForUploads();
    // 等待已接受的首次保存完成，再判断窗口是否真的从未创建过
    await enqueue(async () => {});

    if (disposedRef.current) {
      return false;
    }

    if (closingRef.current || sendingRef.current || discardingRef.current) {
      return false;
    }

    if (missingRef.current) {
      return !loadedRef.current || !hasLocalChanges();
    }

    const snapshot = snapshotOf();

    if (!draftIdRef.current && isEmptySnapshot(snapshot)) {
      return true;
    }

    const prune = hasUnreferencedAttachments(
      sourceRef.current,
      knownAttachmentIdsRef.current,
    );

    return Boolean(await saveDraft(prune ? { prune: true } : undefined));
  };

  let status = '';
  let saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';

  if (readOnly) {
    status = t('compose.editingElsewhere');
    saveState = 'error';
  } else if (missing) {
    status = t('compose.draftDeleted');
    saveState = 'error';
  } else if (error) {
    status = error;
    saveState = 'error';
  } else if (loading || saving || closing) {
    status = saving || closing ? t('compose.saving') : t('common.loading');
    saveState = 'saving';
  } else if (saved) {
    status = t('compose.saved', { time: savedAt });
    saveState = 'saved';
  }

  return {
    windowId,
    to,
    subject,
    source,
    status,
    saveState,
    error,
    loading,
    loadFailed,
    loaded,
    readOnly,
    missing,
    saving,
    closing,
    sending,
    discarding,
    uploading,
    dirty,
    needsCleanup,
    setTo,
    setSubject,
    updateSource,
    setUploading,
    saveNow,
    saveAndClose,
    discardAndClose,
    send,
    discard,
    uploadImage,
    retryLock,
    retryLoad,
    saveAsNew,
    saveForLogout,
  };
}

export type ComposeWindowController = ReturnType<typeof useComposeWindow>;
