import { type MessageListProps, MessageList } from './message-list';
import { type ReaderProps, Reader } from './reader';

import './style.css';

export interface MailProps extends MessageListProps, ReaderProps {}

/**
 * 邮件视图：列表与阅读双栏。
 */
export function Mail({ ...props }: MailProps) {
  return (
    <>
      <MessageList {...props} />
      <Reader {...props} />
    </>
  );
}
