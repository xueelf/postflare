import {
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from '@remixicon/react';

export type ComposeSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ComposeSaveStatusProps {
  state: ComposeSaveState;
  text: string;
}

/**
 * 写信与模板窗口共用的保存状态：图标固定在左，文字起点不随状态变化。
 */
export function ComposeSaveStatus({ state, text }: ComposeSaveStatusProps) {
  return (
    <span
      className="compose-save-status"
      data-state={state}
      role="status"
      title={text || undefined}
    >
      <span className="compose-save-icon" aria-hidden>
        {state === 'saving' ? (
          <RiLoader4Line className="compose-spin" size={16} />
        ) : state === 'saved' ? (
          <RiCheckLine size={16} />
        ) : state === 'error' ? (
          <RiErrorWarningLine size={16} />
        ) : null}
      </span>
      <span className="compose-save-text">{text}</span>
    </span>
  );
}
