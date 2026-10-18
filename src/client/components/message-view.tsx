import type { CSSProperties, ReactNode } from 'react';

import { Avatar } from './avatar';

export interface MessageViewProps {
  avatarName: string;
  correspondent: string;
  addr?: string;
  when: string;
  dateTime: string;
  detailsId?: string;
  children: ReactNode;
}

/**
 * 邮件视图由身份区（头像、昵称、地址、时间）与正文组成，阅读器与模板预览共用。
 * 传入 detailsId 时身份区是详情弹层的触发按钮。
 */
export function MessageView({
  avatarName,
  correspondent,
  addr,
  when,
  dateTime,
  detailsId,
  children,
}: MessageViewProps) {
  const identity = (
    <>
      <Avatar name={avatarName} />
      <span className="message-meta">
        <strong className="correspondent">{correspondent}</strong>
        {addr && <span className="correspondent-address">{addr}</span>}
      </span>
    </>
  );

  return (
    <article className="message">
      <header className="message-head">
        {detailsId ? (
          <button
            type="button"
            className="message-identity"
            popoverTarget={detailsId}
            style={{ anchorName: `--${detailsId}` } as CSSProperties}
          >
            {identity}
          </button>
        ) : (
          <div className="message-identity">{identity}</div>
        )}
        <time className="message-when" dateTime={dateTime}>
          {when}
        </time>
      </header>
      <div className="message-body">{children}</div>
    </article>
  );
}
