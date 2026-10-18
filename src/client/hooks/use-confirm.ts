import { useState } from 'react';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmText: string;
  /** 危险操作（不可恢复）用红色确认按钮 */
  danger?: boolean;
  action: () => void;
}

/**
 * 统一确认框：危险操作先确认再执行。
 */
export function useConfirm() {
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  return {
    confirm,
    askConfirm: (request: ConfirmRequest) => setConfirm(request),
    resolveConfirm: () => {
      confirm?.action();
      setConfirm(null);
    },
    cancelConfirm: () => setConfirm(null),
  };
}
