import PostalMime from 'postal-mime';

import { sqlDate, storeMessage } from './mail-store';

export async function handleInbound(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  // 收件地址必须对应一个未停用的邮箱，否则直接退信
  const mailbox = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ? AND status <> 'disabled'`,
  )
    .bind(message.to)
    .first<{ id: string }>();

  if (!mailbox) {
    message.setReject('No such mailbox');

    return;
  }

  // workers-types 与 DOM 库声明的 ReadableStream 类型不同，运行时一致
  const raw = await new Response(
    message.raw as unknown as BodyInit,
  ).arrayBuffer();
  const parsed = await PostalMime.parse(raw);

  await storeMessage({
    env,
    userId: mailbox.id,
    mailbox: 'inbox',
    direction: 'inbound',
    seen: 0,
    from: parsed.from?.address ?? message.from,
    fromName: (parsed.from?.name ?? '').trim(),
    to: message.to,
    subject: parsed.subject ?? '',
    parsed,
    raw,
    createdAt: sqlDate(undefined),
  });
}
