import PostalMime from 'postal-mime';

import { purgeMessages } from './messages';

// D1 单行上限 2MB，正文超限时按字节截断，完整原文仍在 R2
export const BODY_MAX_BYTES = 900_000;

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

  const id = crypto.randomUUID();
  const rawKey = `raw/${id}.eml`;

  const parsed = await PostalMime.parse(raw);

  // 按 Message-ID 去重，重复投递直接丢弃，不再写 R2
  const inserted = await env.DB.prepare(
    `INSERT INTO messages (
      id, user_id, mailbox, direction, from_address, from_name, to_address, subject,
      body_text, body_html, message_id, in_reply_to, "references", raw_storage_key
    ) VALUES (?, ?, 'inbox', 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, message_id) WHERE message_id IS NOT NULL AND direction = 'inbound' DO NOTHING`,
  )
    .bind(
      id,
      mailbox.id,
      parsed.from?.address ?? message.from,
      (parsed.from?.name ?? '').trim(),
      message.to,
      parsed.subject ?? '',
      capBody(parsed.text ?? null, '(message truncated)'),
      capBody(parsed.html ?? null, '<p>(message truncated)</p>'),
      normalizeMessageId(parsed.messageId),
      normalizeMessageId(parsed.inReplyTo),
      parsed.references ?? null,
      rawKey,
    )
    .run();

  if (inserted.meta.changes === 0) {
    return;
  }

  try {
    await env.ATTACHMENTS.put(rawKey, raw);

    for (const attachment of parsed.attachments) {
      const attachmentId = crypto.randomUUID();
      const storageKey = `attachments/${id}/${attachmentId}`;
      const content = attachment.content as ArrayBuffer;

      await env.ATTACHMENTS.put(storageKey, content);

      await env.DB.prepare(
        `INSERT INTO attachments (
          id, message_id, filename, content_type, size_bytes, storage_key
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          attachmentId,
          id,
          attachment.filename ?? 'attachment',
          attachment.mimeType,
          content.byteLength,
          storageKey,
        )
        .run();
    }
  } catch (error) {
    // 附件没写完就把这封邮件撤掉，否则 Message-ID 去重会让投递重试跳过，这封邮件永远缺附件
    await purgeMessages(env, [id]);

    throw error;
  }
}

export function normalizeMessageId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^</, '').replace(/>$/, '');
}

/**
 * 正文按字节上限截断，超限时补一句说明，避免超过 D1 单行上限。
 */
export function capBody(value: string | null, notice: string): string | null {
  if (value === null) {
    return null;
  }
  const encoder = new TextEncoder();
  const size = encoder.encode(value).length;

  if (size <= BODY_MAX_BYTES) {
    return value;
  }

  const budget = BODY_MAX_BYTES - encoder.encode(notice).length;

  let end = Math.floor((value.length * budget) / size);
  let head = value.slice(0, end);

  // 按字节比例粗切后再收窄，避免多字节字符让实际长度超标
  while (end > 0 && encoder.encode(head).length > budget) {
    end = Math.floor(end * 0.9);
    head = value.slice(0, end);
  }
  return head + notice;
}
