import { useEffect, useRef } from 'react';

import { Modal } from '../modal';

import './style.css';

import { Button } from '../button';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 确认弹窗：危险操作的二次确认。
 */
export function ConfirmDialog({
  title,
  message,
  confirmText,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 打开后聚焦安全的「取消」，而不是右上角的关闭按钮
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <Modal
      title={title}
      onDismiss={onCancel}
      footer={
        <>
          <button ref={cancelRef} type="button" onClick={onCancel}>
            取消
          </button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}
