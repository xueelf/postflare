import { RiCloseLine } from '@remixicon/react';
import { type ReactNode, useEffect, useRef } from 'react';

import { useI18n } from '#/client/i18n';

import './style.css';

import { Button } from '#/client/components/button';
import { DialogHead } from '#/client/components/dialog-head';

export interface ModalProps {
  title: string;
  size?: 'sm' | 'lg' | 'page';
  onDismiss?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * 模态弹窗基于原生 dialog，头部是居中标题与关闭按钮，底部是动作插槽。
 * 挂载期间保持打开，ESC、遮罩与关闭按钮统一走 onDismiss，浏览器原生关闭会被恢复。
 */
export function Modal({
  title,
  size = 'sm',
  onDismiss,
  footer,
  children,
}: ModalProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const opened = useRef(false);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;

    if (!dialog) {
      return;
    }
    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        lastFocused.current = event.target;
      }
    };

    dialog.addEventListener('focusin', handleFocusIn);

    return () => dialog.removeEventListener('focusin', handleFocusIn);
  }, []);

  // 挂载期间保持打开，cancel 不可取消时浏览器会直接关闭（ESC 连按等），
  // 这类关闭不经过 React，只能在每次渲染后检查并恢复，故意不写依赖数组
  useEffect(() => {
    const dialog = ref.current;

    if (!dialog || !dialog.isConnected) {
      return;
    }

    if (!dialog.open) {
      // 首次挂载正常打开，被浏览器原生关闭后等上层弹窗关闭再恢复
      if (
        opened.current &&
        document.querySelectorAll('dialog[open]').length > 0
      ) {
        return;
      }
      dialog.showModal();
      opened.current = true;
      lastFocused.current?.focus();

      return;
    }
    // 上层弹窗关闭后焦点落回页面时，回到弹窗内最后聚焦的元素
    const dialogs = document.querySelectorAll('dialog[open]');

    if (dialogs.length === 1 && !dialog.contains(document.activeElement)) {
      lastFocused.current?.focus();
    }
  });

  // 关闭只由卸载触发，打开状态始终跟随界面状态，焦点不落到按钮等非输入元素上
  useEffect(() => {
    const dialog = ref.current;

    return () => {
      dialog?.close();

      const active = document.activeElement;

      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        !active.matches('input, textarea, select')
      ) {
        active.blur();
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-label={title}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) {
          return;
        }
        event.preventDefault();
        onDismiss?.();
      }}
      onCancel={event => {
        event.preventDefault();
        onDismiss?.();
      }}
      onClick={event => {
        if (event.target === ref.current) {
          onDismiss?.();
        }
      }}
    >
      <DialogHead title={title}>
        {onDismiss && (
          <Button variant="icon" onClick={onDismiss} aria-label={t('ui.close')}>
            <RiCloseLine size={20} aria-hidden />
          </Button>
        )}
      </DialogHead>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}
