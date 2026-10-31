import { useEffect, useRef, useState } from 'react';

export interface ComposeWindowState {
  id: string;
  kind: 'message' | 'template';
  draftId: string | null;
  templateId: string | null;
  initialTo: string;
  minimized: boolean;
  fullscreen: boolean;
  dirty: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * 写信窗口管理器：只负责窗口列表、位置、层级和最小化。
 * 每个窗口的内容与保存生命周期由各自的 Hook 持有。
 */
export function useComposeWindows() {
  const [windows, setWindows] = useState<ComposeWindowState[]>([]);
  const zRef = useRef(1);
  const saveActionsRef = useRef(new Map<string, () => Promise<boolean>>());

  const clampPosition = (x: number, y: number) => {
    const width = Math.min(680, window.innerWidth - 32);
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - 48);

    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  };

  const openWindowCount = (windows: ComposeWindowState[]) =>
    windows.filter(window => !window.minimized).length;

  const position = (count: number) => {
    const width = Math.min(680, window.innerWidth - 32);
    const height = Math.min(600, window.innerHeight * 0.82);
    const offset = (count % 4) * 24;

    // 桌面端从视口中心开始，多个窗口保留少量层叠偏移
    return clampPosition(
      (window.innerWidth - width) / 2 + offset,
      (window.innerHeight - height) / 2 + offset,
    );
  };

  const singleExpanded = (windows: ComposeWindowState[]) => {
    if (!window.matchMedia('(max-width: 720px)').matches) {
      return windows;
    }
    const active = windows
      .filter(window => !window.minimized)
      .sort((left, right) => right.z - left.z)[0];

    return windows.map(window => ({
      ...window,
      minimized: window.id !== active?.id,
    }));
  };

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)');
    const normalize = () =>
      setWindows(current => {
        const next = singleExpanded(current).map(window => {
          const position = clampPosition(window.x, window.y);

          return position.x === window.x && position.y === window.y
            ? window
            : { ...window, ...position };
        });
        const changed = next.some((window, index) => {
          const previous = current[index];

          return (
            !previous ||
            window.minimized !== previous.minimized ||
            window.x !== previous.x ||
            window.y !== previous.y
          );
        });

        return changed ? next : current;
      });

    window.addEventListener('resize', normalize);
    query.addEventListener('change', normalize);

    return () => {
      window.removeEventListener('resize', normalize);
      query.removeEventListener('change', normalize);
    };
  }, []);

  const focusWindow = (windowId: string) => {
    setWindows(current =>
      singleExpanded(
        current.map(window =>
          window.id === windowId
            ? { ...window, z: (zRef.current += 1) }
            : window,
        ),
      ),
    );
  };

  const openNew = (initialTo = '') => {
    setWindows(current => {
      const { x, y } = position(openWindowCount(current));

      return singleExpanded([
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'message',
          draftId: null,
          templateId: null,
          initialTo,
          minimized: false,
          fullscreen: false,
          dirty: false,
          x,
          y,
          z: (zRef.current += 1),
        },
      ]);
    });
  };

  const openDraft = (draftId: string, initialTo = '') => {
    setWindows(current => {
      const existing = current.find(window => window.draftId === draftId);

      if (existing) {
        return singleExpanded(
          current.map(window =>
            window.id === existing.id
              ? {
                  ...window,
                  ...clampPosition(window.x, window.y),
                  minimized: false,
                  z: (zRef.current += 1),
                }
              : window,
          ),
        );
      }
      const { x, y } = position(openWindowCount(current));

      return singleExpanded([
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'message',
          draftId,
          templateId: null,
          initialTo,
          minimized: false,
          fullscreen: false,
          dirty: false,
          x,
          y,
          z: (zRef.current += 1),
        },
      ]);
    });
  };

  const registerSave = (windowId: string, save: () => Promise<boolean>) => {
    saveActionsRef.current.set(windowId, save);
  };

  const unregisterSave = (windowId: string) => {
    saveActionsRef.current.delete(windowId);
  };

  const setWindowDirty = (windowId: string, dirty: boolean) => {
    setWindows(current =>
      current.map(window =>
        window.id === windowId && window.dirty !== dirty
          ? { ...window, dirty }
          : window,
      ),
    );
  };

  const saveAll = async (): Promise<boolean> => {
    for (const save of saveActionsRef.current.values()) {
      if (!(await save())) {
        return false;
      }
    }

    return true;
  };

  const openTemplate = (templateId: string) => {
    setWindows(current => {
      const existing = current.find(window => window.templateId === templateId);

      if (existing) {
        return singleExpanded(
          current.map(window =>
            window.id === existing.id
              ? {
                  ...window,
                  ...clampPosition(window.x, window.y),
                  minimized: false,
                  z: (zRef.current += 1),
                }
              : window,
          ),
        );
      }
      const { x, y } = position(openWindowCount(current));

      return singleExpanded([
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'template',
          draftId: null,
          templateId,
          initialTo: '',
          minimized: false,
          fullscreen: false,
          dirty: false,
          x,
          y,
          z: (zRef.current += 1),
        },
      ]);
    });
  };

  const registerDraftId = (windowId: string, draftId: string) => {
    setWindows(current =>
      current.map(window =>
        window.id === windowId ? { ...window, draftId } : window,
      ),
    );
  };

  const closeWindow = (windowId: string) => {
    saveActionsRef.current.delete(windowId);
    setWindows(current => current.filter(window => window.id !== windowId));
  };

  const minimize = (windowId: string) => {
    setWindows(current =>
      singleExpanded(
        current.map(window =>
          window.id === windowId ? { ...window, minimized: true } : window,
        ),
      ),
    );
  };

  const restoreWindow = (windowId: string) => {
    setWindows(current =>
      singleExpanded(
        current.map(window =>
          window.id === windowId
            ? {
                ...window,
                ...clampPosition(window.x, window.y),
                minimized: false,
                z: (zRef.current += 1),
              }
            : window,
        ),
      ),
    );
  };

  const toggleFullscreen = (windowId: string) => {
    setWindows(current => {
      const target = current.find(window => window.id === windowId);

      if (!target) {
        return current;
      }
      const fullscreen = !target.fullscreen;

      return current.map(window => {
        if (window.id !== windowId) {
          return { ...window, fullscreen: false };
        }
        const position = fullscreen ? {} : clampPosition(window.x, window.y);

        return {
          ...window,
          ...position,
          fullscreen,
          z: (zRef.current += 1),
        };
      });
    });
  };

  const moveWindow = (windowId: string, x: number, y: number) => {
    const position = clampPosition(x, y);

    setWindows(current =>
      current.map(window =>
        window.id === windowId ? { ...window, ...position } : window,
      ),
    );
  };

  return {
    windows,
    openNew,
    openDraft,
    openTemplate,
    registerDraftId,
    closeWindow,
    minimize,
    restoreWindow,
    toggleFullscreen,
    moveWindow,
    focusWindow,
    registerSave,
    unregisterSave,
    setWindowDirty,
    saveAll,
  };
}

export type ComposeWindowsController = ReturnType<typeof useComposeWindows>;
