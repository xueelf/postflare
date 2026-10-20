import { useMemo, useState } from 'react';

import { buildEmailDocument } from '#/client/email-document';

interface EmailBodyState {
  resetKey: string;
  allowRemote: boolean;
}

/**
 * 邮件正文的渲染状态。切换邮件时重置远程内容许可，避免新邮件沿用上一封的放行状态。
 */
export function useEmailBody(html: string, resetKey: string) {
  const [state, setState] = useState<EmailBodyState>({
    resetKey,
    allowRemote: false,
  });
  const allowRemote = state.resetKey === resetKey ? state.allowRemote : false;

  if (state.resetKey !== resetKey) {
    setState({ resetKey, allowRemote: false });
  }

  const emailDocument = useMemo(
    () => buildEmailDocument(html, allowRemote),
    [html, allowRemote],
  );

  return {
    allowRemote,
    emailDocument,
    allowRemoteContent: () =>
      setState(current => ({ ...current, allowRemote: true })),
  };
}
