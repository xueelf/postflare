import {
  RiCloseLine,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiLoader4Line,
  RiSubtractLine,
} from '@remixicon/react';
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '#/client/components/button';
import { useI18n } from '#/client/i18n';

import './window.css';

const DOCK_BOTTOM = 16;
// 最小化条目高 54px，额外留出 8px 间距
const DOCK_STEP = 62;

export interface ComposeFrameProps {
  title: string;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
  fullscreen: boolean;
  dockIndex: number;
  dockTitle: string;
  dockStatus: ReactNode;
  busy: boolean;
  closing: boolean;
  closeDisabled?: boolean;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onMinimize: () => void;
  onRestore: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onSaveShortcut?: () => void;
  status: ReactNode;
  toolbar: ReactNode;
  toolbarAnchor: string;
  children: ReactNode;
}

/**
 * 写信与模板编辑共用的浮窗框架：拖动、最小化、关闭、状态行和底部工具栏。
 */
export function ComposeFrame({
  title,
  x,
  y,
  z,
  minimized,
  fullscreen,
  dockIndex,
  dockTitle,
  dockStatus,
  busy,
  closing,
  closeDisabled = false,
  onFocus,
  onMove,
  onMinimize,
  onRestore,
  onToggleFullscreen,
  onClose,
  onSaveShortcut,
  status,
  toolbar,
  toolbarAnchor,
  children,
}: ComposeFrameProps) {
  const { t } = useI18n();
  const [mobile, setMobile] = useState(
    () => window.matchMedia('(max-width: 720px)').matches,
  );
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)');
    const update = () => setMobile(query.matches);

    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest('button') ||
      mobile ||
      fullscreen
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: x,
      originY: y,
    };
    onFocus();
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const width = Math.min(680, window.innerWidth - 32);
    const maxX = Math.max(0, window.innerWidth - width);
    const maxY = Math.max(0, window.innerHeight - 48);

    onMove(
      Math.min(Math.max(0, drag.originX + event.clientX - drag.startX), maxX),
      Math.min(Math.max(0, drag.originY + event.clientY - drag.startY), maxY),
    );
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const onFocusIn = (event: FocusEvent<HTMLDivElement>) => {
    const previous = event.relatedTarget;

    // 窗口内部切换字段时不再重复提升层级
    if (previous instanceof Node && event.currentTarget.contains(previous)) {
      return;
    }
    onFocus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      onSaveShortcut &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 's'
    ) {
      event.preventDefault();
      onSaveShortcut();
    }
  };

  return (
    <>
      {minimized ? (
        <div
          className="compose-dock"
          style={{
            zIndex: z,
            bottom: DOCK_BOTTOM + dockIndex * DOCK_STEP,
          }}
        >
          <button
            type="button"
            className="compose-dock-main"
            onClick={onRestore}
            aria-label={t('compose.restore')}
          >
            <span className="compose-dock-title">{dockTitle}</span>
            <span className="compose-dock-status">
              {busy ? (
                <RiLoader4Line className="compose-spin" size={14} />
              ) : null}
              {dockStatus}
            </span>
          </button>
          <Button
            variant="icon"
            onClick={onClose}
            disabled={closing || closeDisabled}
            aria-label={t('ui.close')}
          >
            <RiCloseLine size={18} aria-hidden />
          </Button>
        </div>
      ) : null}
      <div
        className={
          fullscreen
            ? 'compose-window compose-window-fullscreen'
            : 'compose-window'
        }
        style={{
          left: mobile || fullscreen ? undefined : x,
          top: mobile || fullscreen ? undefined : y,
          zIndex: z,
          display: minimized ? 'none' : undefined,
        }}
        role="dialog"
        aria-label={title}
        onPointerDown={onFocus}
        onFocus={onFocusIn}
        onKeyDown={onKeyDown}
      >
        <div
          className="compose-window-head"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="compose-window-title">{title}</span>
          <div className="compose-window-actions">
            <Button
              variant="icon"
              onClick={onMinimize}
              disabled={closing}
              aria-label={t('compose.minimize')}
              title={t('compose.minimize')}
            >
              <RiSubtractLine size={20} aria-hidden />
            </Button>
            {mobile ? null : (
              <Button
                variant="icon"
                onClick={onToggleFullscreen}
                disabled={closing}
                aria-label={
                  fullscreen
                    ? t('compose.exitFullscreen')
                    : t('compose.fullscreen')
                }
                title={
                  fullscreen
                    ? t('compose.exitFullscreen')
                    : t('compose.fullscreen')
                }
                aria-pressed={fullscreen}
              >
                {fullscreen ? (
                  <RiFullscreenExitLine size={20} aria-hidden />
                ) : (
                  <RiFullscreenLine size={20} aria-hidden />
                )}
              </Button>
            )}
            <Button
              variant="icon"
              onClick={onClose}
              disabled={closeDisabled || closing}
              aria-label={t('ui.close')}
              title={t('ui.close')}
            >
              {closing ? (
                <RiLoader4Line className="compose-spin" size={20} aria-hidden />
              ) : (
                <RiCloseLine size={20} aria-hidden />
              )}
            </Button>
          </div>
        </div>
        <div className="compose-window-body">{children}</div>
        <div className="compose-window-status">{status}</div>
        <div
          className="compose-window-toolbar"
          style={{ anchorName: toolbarAnchor } as CSSProperties}
        >
          {toolbar}
        </div>
      </div>
    </>
  );
}
