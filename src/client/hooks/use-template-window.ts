import { useEffect, useRef, useState } from 'react';

import {
  extractAttachmentIds,
  hasUnreferencedAttachments,
} from '#/attachment-url';
import { apiFetch } from '#/client/api';
import { useToast } from '#/client/components/toast';
import { dateTimeValue, formatTime } from '#/client/format';
import { useI18n } from '#/client/i18n';
import { compileInky } from '#/client/inky';
import { templateLockName } from '#/client/locks';
import { AttachmentUploadError, uploadAttachment } from '#/client/upload';

const AUTOSAVE_DELAY = 2000;

interface TemplateSnapshot {
  name: string;
  subject: string;
  source: string;
}

interface LockAttempt {
  attempt: number;
  release: (() => void) | null;
}

interface TemplateRecord {
  id: string;
  name: string;
  subject: string;
  body_source: string;
  updated_at: string;
}

export interface TemplateWindowDeps {
  userId: string;
  windowId: string;
  templateId: string;
  initial: TemplateSnapshot;
  onClose: (windowId: string) => void;
  onCreated: (templateId: string) => void;
  onDeleted: () => void;
  refreshTemplates: () => void;
}

/**
 * 模板编辑窗口：与草稿相同的自动保存、上传、关闭等待和跨标签只读。
 */
export function useTemplateWindow(deps: TemplateWindowDeps) {
  const {
    userId,
    windowId,
    templateId,
    initial,
    onClose,
    onCreated,
    onDeleted,
    refreshTemplates,
  } = deps;
  const { locale, t } = useI18n();
  const toast = useToast();
  const [name, setNameState] = useState(initial.name);
  const [subject, setSubjectState] = useState(initial.subject);
  const [source, setSourceState] = useState(initial.source);
  const [saved, setSaved] = useState<TemplateSnapshot>(initial);
  const [savedAt, setSavedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [uploading, setUploadingState] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [missing, setMissing] = useState(false);
  const missingRef = useRef(false);
  const nameRef = useRef(initial.name);
  const subjectRef = useRef(initial.subject);
  const sourceRef = useRef(initial.source);
  const savedRef = useRef(initial);
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeSavesRef = useRef(0);
  const closingRef = useRef(false);
  const disposedRef = useRef(false);
  const abortRef = useRef(new AbortController());
  const uploadingRef = useRef(false);
  const uploadWaitersRef = useRef<Array<() => void>>([]);
  const uploadQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const cancelUploadsRef = useRef(false);
  const knownAttachmentIdsRef = useRef<string[]>(
    extractAttachmentIds(initial.source),
  );
  const releaseLockRef = useRef<(() => void) | null>(null);
  const lockAttemptRef = useRef(0);
  const startingRef = useRef(false);
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

  const snapshotOf = (): TemplateSnapshot => ({
    name: nameRef.current,
    subject: subjectRef.current,
    source: sourceRef.current,
  });

  const sameSnapshot = (left: TemplateSnapshot, right: TemplateSnapshot) =>
    left.name === right.name &&
    left.subject === right.subject &&
    left.source === right.source;

  const acquireLock = (): Promise<LockAttempt> => {
    releaseLockRef.current?.();
    releaseLockRef.current = null;

    const attempt = (lockAttemptRef.current += 1);

    if (typeof navigator === 'undefined' || !navigator.locks) {
      return Promise.resolve({ attempt, release: () => {} });
    }

    return new Promise(resolve => {
      let settled = false;

      const settle = (value: LockAttempt) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      navigator.locks
        .request(
          templateLockName(userId, templateId),
          { ifAvailable: true },
          async lock => {
            if (!lock) {
              settle({ attempt, release: null });

              return;
            }

            if (disposedRef.current || attempt !== lockAttemptRef.current) {
              settle({ attempt, release: null });

              return;
            }

            let release!: () => void;

            const held = new Promise<void>(resolveHeld => {
              release = resolveHeld;
            });

            releaseLockRef.current = release;
            settle({ attempt, release });
            await held;
          },
        )
        .catch(() => {
          settle({ attempt, release: null });
        });
    });
  };

  const applyTemplate = (template: TemplateRecord) => {
    const source = template.body_source;
    const snapshot = {
      name: template.name,
      subject: template.subject,
      source,
    };

    nameRef.current = template.name;
    subjectRef.current = template.subject;
    sourceRef.current = source;
    setNameState(template.name);
    setSubjectState(template.subject);
    setSourceState(source);
    savedRef.current = snapshot;
    setSaved(snapshot);

    setSavedAt(
      formatTime(new Date(dateTimeValue(template.updated_at)), locale),
    );
    knownAttachmentIdsRef.current = extractAttachmentIds(source);
    missingRef.current = false;
    setMissing(false);
    setLoadFailed(false);
    setLoaded(true);
    setError('');
  };

  const loadTemplate = async (
    isCurrent: () => boolean,
  ): Promise<'ok' | 'missing' | 'error' | 'stale'> => {
    try {
      const res = await apiFetch('/api/templates', {
        signal: abortRef.current.signal,
      });

      if (disposedRef.current || !isCurrent()) {
        return 'stale';
      }

      if (!res.ok) {
        setLoadFailed(true);
        setError(t('common.loadFailed'));

        return 'error';
      }
      const templates = (await res.json()) as TemplateRecord[];

      if (disposedRef.current || !isCurrent()) {
        return 'stale';
      }
      const current = templates.find(template => template.id === templateId);

      if (!current) {
        missingRef.current = true;
        setMissing(true);
        setLoadFailed(false);
        setError(t('templates.deleted'));

        return 'missing';
      }
      applyTemplate(current);

      return 'ok';
    } catch {
      if (!disposedRef.current && isCurrent()) {
        setLoadFailed(true);
        setError(t('common.loadFailed'));

        return 'error';
      }

      return 'stale';
    }
  };

  const startEditing = async (): Promise<boolean> => {
    if (startingRef.current) {
      return false;
    }
    startingRef.current = true;
    setLoading(true);

    try {
      const lock = await acquireLock();

      if (disposedRef.current || lock.attempt !== lockAttemptRef.current) {
        lock.release?.();

        return false;
      }

      if (!lock.release) {
        setLoading(false);
        markReadOnly(true);

        return false;
      }

      const isCurrent = () =>
        !disposedRef.current && lock.attempt === lockAttemptRef.current;
      const loaded = await loadTemplate(isCurrent);

      if (!isCurrent() || loaded === 'stale') {
        lock.release();

        return false;
      }

      if (loaded !== 'ok') {
        lock.release();

        if (releaseLockRef.current === lock.release) {
          releaseLockRef.current = null;
        }
        markReadOnly(loaded === 'error');
        setLoading(false);

        return false;
      }

      markReadOnly(false);
      setLoading(false);

      return true;
    } finally {
      startingRef.current = false;
    }
  };

  useEffect(() => {
    startEditing().catch(() => {});
  }, []);

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

  const setName = (value: string) => {
    if (closingRef.current) {
      return;
    }
    nameRef.current = value;
    setNameState(value);
  };

  const setSubject = (value: string) => {
    if (closingRef.current) {
      return;
    }
    subjectRef.current = value;
    setSubjectState(value);
  };

  const updateSource = (value: string) => {
    // 关闭期间只冻结用户输入，已接受上传的结果仍需回写最终源码。
    sourceRef.current = value;
    setSourceState(value);
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
    snapshot: TemplateSnapshot,
    options: { prune?: boolean } = {},
  ): Promise<
    { ok: true } | { ok: false; error: string; missing?: boolean }
  > => {
    if (disposedRef.current) {
      return { ok: false, error: 'disposed' };
    }

    const html = (await compileInky(snapshot.source)).html;

    if (disposedRef.current) {
      return { ok: false, error: 'disposed' };
    }

    const res = await apiFetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      signal: abortRef.current.signal,
      body: JSON.stringify({
        name: snapshot.name,
        subject: snapshot.subject,
        body_html: html,
        body_source: snapshot.source,
        pruneIds: options.prune ? knownAttachmentIdsRef.current : undefined,
      }),
    });

    if (res.status === 404) {
      return { ok: false, error: 'template deleted', missing: true };
    }

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      return { ok: false, error: data.error ?? 'save failed' };
    }

    if (options.prune) {
      knownAttachmentIdsRef.current = extractAttachmentIds(snapshot.source);
    }

    return { ok: true };
  };

  const applySaved = (snapshot: TemplateSnapshot) => {
    savedRef.current = snapshot;
    setSaved(snapshot);
    setSavedAt(formatTime(new Date(), locale));
    refreshTemplates();
  };

  const save = (options?: { prune?: boolean }): Promise<boolean> => {
    const snapshot = snapshotOf();

    if (loading || readOnlyRef.current || missingRef.current) {
      return Promise.resolve(false);
    }

    if (!snapshot.name.trim()) {
      setError(t('templates.nameEmpty'));

      return Promise.resolve(false);
    }

    activeSavesRef.current += 1;
    setSaving(true);
    setError('');

    return enqueue(async () => {
      if (disposedRef.current || readOnlyRef.current) {
        return false;
      }

      if (sameSnapshot(savedRef.current, snapshot) && !options?.prune) {
        return true;
      }

      let result: Awaited<ReturnType<typeof persist>>;

      try {
        result = await persist(snapshot, options);
      } catch {
        result = { ok: false, error: 'save failed' };
      }

      if (disposedRef.current) {
        return false;
      }

      if (!result.ok) {
        if (result.missing) {
          missingRef.current = true;
          setMissing(true);
          setError(t('templates.deleted'));
        } else {
          setError(
            result.error === 'template name is empty'
              ? t('templates.nameEmpty')
              : t('templates.saveFailedRetry'),
          );
        }

        return false;
      }

      applySaved(snapshot);

      return true;
    }).finally(() => {
      activeSavesRef.current -= 1;

      if (activeSavesRef.current === 0) {
        setSaving(false);
      }
    });
  };

  const saveNow = async () => {
    if (closingRef.current) {
      return;
    }

    if (await save()) {
      toast.success(t('templates.saved'));
    }
  };

  const saveAndClose = async (): Promise<boolean> => {
    if (closingRef.current) {
      return false;
    }

    closingRef.current = true;
    setClosing(true);

    try {
      if (loading || readOnlyRef.current) {
        onClose(windowId);

        return true;
      }

      if (missingRef.current) {
        if (!loaded || sameSnapshot(savedRef.current, snapshotOf())) {
          onClose(windowId);

          return true;
        }
        setError(t('templates.deleted'));

        return false;
      }

      await waitForUploads();

      if (disposedRef.current) {
        return false;
      }

      const ok = await save({ prune: true });

      if (disposedRef.current) {
        return false;
      }

      if (!ok) {
        return false;
      }

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
    if (closingRef.current) {
      return false;
    }

    closingRef.current = true;
    cancelUploadsRef.current = true;
    setClosing(true);
    onClose(windowId);

    return true;
  };

  const deleteTemplate = async (): Promise<boolean> => {
    if (closingRef.current || readOnlyRef.current || missingRef.current) {
      return false;
    }

    closingRef.current = true;
    cancelUploadsRef.current = true;
    setClosing(true);

    try {
      await waitForUploads();
      await writeChainRef.current.catch(() => {});

      if (disposedRef.current) {
        return false;
      }

      const res = await apiFetch(`/api/templates/${templateId}`, {
        method: 'DELETE',
        signal: abortRef.current.signal,
      });

      if (disposedRef.current) {
        return false;
      }

      if (!res.ok && res.status !== 404) {
        toast.error(t('templates.deleteFailed', { status: res.status }));

        return false;
      }

      toast.success(t('templates.deleted'));
      refreshTemplates();
      onDeleted();
      onClose(windowId);

      return true;
    } catch {
      if (!disposedRef.current) {
        toast.error(t('templates.deleteFailedRetry'));
      }

      return false;
    } finally {
      if (!disposedRef.current) {
        closingRef.current = false;
        cancelUploadsRef.current = false;
        setClosing(false);
      }
    }
  };

  const saveAsNew = async (): Promise<boolean> => {
    if (disposedRef.current || readOnlyRef.current || closingRef.current) {
      return false;
    }

    const snapshot = snapshotOf();

    if (!snapshot.name.trim()) {
      setError(t('templates.nameEmpty'));

      return false;
    }

    closingRef.current = true;
    setClosing(true);

    let completed = false;

    try {
      const html = (await compileInky(snapshot.source)).html;

      if (disposedRef.current) {
        return false;
      }

      const res = await apiFetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          name: snapshot.name,
          subject: snapshot.subject,
          body_html: html,
          body_source: snapshot.source,
        }),
      });

      if (disposedRef.current) {
        return false;
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };

        setError(
          data.error === 'template name is empty'
            ? t('templates.nameEmpty')
            : t('templates.saveFailedRetry'),
        );

        return false;
      }

      const data = (await res.json()) as { id: string };

      if (disposedRef.current) {
        return false;
      }

      missingRef.current = false;
      setMissing(false);
      setLoaded(true);
      toast.success(t('templates.saved'));
      refreshTemplates();
      onCreated(data.id);
      onClose(windowId);
      completed = true;

      return true;
    } catch {
      if (!disposedRef.current) {
        setError(t('templates.saveFailedRetry'));
      }

      return false;
    } finally {
      if (!completed && !disposedRef.current) {
        closingRef.current = false;
        setClosing(false);
      }
    }
  };

  const retryLock = async () => {
    await startEditing();
  };

  const uploadImageNow = async (
    file: File,
    apply: (url: string) => boolean,
  ): Promise<void> => {
    if (
      disposedRef.current ||
      readOnlyRef.current ||
      cancelUploadsRef.current
    ) {
      throw new Error('template closed');
    }

    if (!file.type.startsWith('image/')) {
      toast.error(t('compose.imageUploadFailed'));

      throw new Error('unsupported image type');
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
        { templateId },
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
    if (disposedRef.current || readOnlyRef.current || closingRef.current) {
      return Promise.reject(new Error('template closed'));
    }

    const run = uploadQueueRef.current.then(() => uploadImageNow(file, apply));

    uploadQueueRef.current = run.catch(() => {});

    return run;
  };

  const needsCleanup = hasUnreferencedAttachments(
    source,
    knownAttachmentIdsRef.current,
  );
  const dirty = !sameSnapshot(saved, snapshotOf());

  const saveForLogout = async (): Promise<boolean> => {
    if (readOnlyRef.current || loading) {
      return true;
    }

    await waitForUploads();

    if (disposedRef.current) {
      return false;
    }

    if (closingRef.current) {
      return false;
    }

    if (missingRef.current) {
      return !loaded || sameSnapshot(savedRef.current, snapshotOf());
    }

    const prune = hasUnreferencedAttachments(
      sourceRef.current,
      knownAttachmentIdsRef.current,
    );

    return save(prune ? { prune: true } : undefined);
  };

  let status = '';
  let saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';

  if (loading) {
    status = t('common.loading');
    saveState = 'saving';
  } else if (readOnly && !loadFailed) {
    status = t('compose.editingElsewhere');
    saveState = 'error';
  } else if (missing) {
    status = t('templates.deleted');
    saveState = 'error';
  } else if (error) {
    status = error;
    saveState = 'error';
  } else if (saving || closing) {
    status = t('templates.saving');
    saveState = 'saving';
  } else if (savedAt) {
    status = t('compose.saved', { time: savedAt });
    saveState = 'saved';
  }

  useEffect(() => {
    if (
      loading ||
      readOnly ||
      missing ||
      closing ||
      saving ||
      !name.trim() ||
      sameSnapshot(savedRef.current, snapshotOf())
    ) {
      return;
    }

    const timer = setTimeout(() => {
      save().catch(() => {});
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [loading, readOnly, closing, saving, name, subject, source, saved]);

  return {
    windowId,
    name,
    subject,
    source,
    savedAt,
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
    uploading,
    dirty,
    needsCleanup,
    setName,
    setSubject,
    updateSource,
    setUploading,
    saveNow,
    saveAndClose,
    discardAndClose,
    deleteTemplate,
    retryLock,
    saveAsNew,
    uploadImage,
    saveForLogout,
  };
}

export type TemplateWindowController = ReturnType<typeof useTemplateWindow>;
