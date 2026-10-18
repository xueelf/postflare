import { matchPath } from 'react-router';

export type View =
  'inbox' | 'drafts' | 'sent' | 'spam' | 'trash' | 'templates' | 'users';

export const MAILBOX_VIEWS: View[] = [
  'inbox',
  'drafts',
  'sent',
  'spam',
  'trash',
];

interface RouteState {
  view: View;
  messageId: string | null;
}

export interface MailRoute {
  view: View;
  messageId: string | null;
  q: string;
  compose: boolean;
  template: boolean;
  path: string;
}

/**
 * 解析路径为视图与打开的邮件，无效路径回落到收件箱。
 */
export function parseRoute(pathname: string): RouteState {
  const match = matchPath('/:mailbox/:id?', pathname);
  const mailbox = match?.params.mailbox;

  if (mailbox && MAILBOX_VIEWS.includes(mailbox as View)) {
    return { view: mailbox as View, messageId: match?.params.id ?? null };
  }
  const templateMatch = matchPath('/templates/:id', pathname);

  if (pathname === '/templates' || templateMatch) {
    return { view: 'templates', messageId: templateMatch?.params.id ?? null };
  }

  if (pathname === '/users') {
    return { view: 'users', messageId: null };
  }
  return { view: 'inbox', messageId: null };
}

/**
 * 弹窗片段只保留一级，弹窗内部的层级不进地址：
 * #template 是模板弹窗，#settings 是设置弹窗。
 */
export function isTemplateDialog(hash: string): boolean {
  return hash === '#template';
}

export function isSettingsDialog(hash: string): boolean {
  return hash === '#settings';
}

/**
 * 构造文件夹（或其中一封邮件）的路径，q 为空时不带查询串。
 */
export function viewPath(
  view: View,
  messageId: string | null = null,
  q = '',
): string {
  const path = messageId ? `/${view}/${messageId}` : `/${view}`;

  return q ? `${path}?q=${encodeURIComponent(q)}` : path;
}
