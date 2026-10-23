import type { Email } from 'postal-mime';

import { normalizeContentId } from './attachments';
import { isUniqueViolation } from './http';
import { purgeMessages } from './messages';

// D1 单行上限 2MB，正文超限时按字节截断，完整原文仍在 R2
export const BODY_MAX_BYTES = 900_000;

interface StoreMessageInput {
  env: Env;
  userId: string;
  mailbox: 'inbox' | 'sent';
  direction: 'inbound' | 'outbound';
  seen: number;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  parsed: Email;
  raw: ArrayBuffer;
  createdAt: string;
}

/**
 * 保存一封已解析的邮件，供收信和 EML 导入共用。
 * 返回 null 表示 Message-ID 重复。
 */
export async function storeMessage({
  env,
  userId,
  mailbox,
  direction,
  seen,
  from,
  fromName,
  to,
  subject,
  parsed,
  raw,
  createdAt,
}: StoreMessageInput): Promise<string | null> {
  const id = crypto.randomUUID();
  const messageId = normalizeMessageId(parsed.messageId);

  if (messageId) {
    const existing = await env.DB.prepare(
      `SELECT id FROM messages
       WHERE user_id = ? AND direction = ? AND message_id = ?
       LIMIT 1`,
    )
      .bind(userId, direction, messageId)
      .first<{ id: string }>();

    if (existing) {
      return null;
    }
  }

  const rawKey = `raw/${id}.eml`;

  try {
    await env.DB.prepare(
      `INSERT INTO messages (
         id, user_id, mailbox, direction, seen, from_address, from_name,
         to_address, subject, body_text, body_html, message_id, in_reply_to,
         "references", raw_storage_key, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        userId,
        mailbox,
        direction,
        seen,
        from,
        fromName,
        to,
        subject,
        capBody(parsed.text ?? null, '(message truncated)'),
        capBody(parsed.html ?? null, '<p>(message truncated)</p>'),
        messageId,
        normalizeMessageId(parsed.inReplyTo),
        parsed.references ?? null,
        rawKey,
        createdAt,
      )
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return null;
    }
    throw error;
  }

  try {
    await env.ATTACHMENTS.put(rawKey, raw);

    for (const attachment of parsed.attachments) {
      const attachmentId = crypto.randomUUID();
      const storageKey = `attachments/${id}/${attachmentId}`;
      const content = attachment.content as ArrayBuffer;
      const contentId =
        attachment.disposition === 'attachment'
          ? null
          : normalizeContentId(attachment.contentId);

      await env.ATTACHMENTS.put(storageKey, content);

      await env.DB.prepare(
        `INSERT INTO attachments (
           id, message_id, filename, content_type, content_id, size_bytes, storage_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          attachmentId,
          id,
          attachment.filename ?? 'attachment',
          attachment.mimeType,
          contentId,
          content.byteLength,
          storageKey,
        )
        .run();
    }
  } catch (error) {
    // 附件没写完就把这封邮件撤掉，避免留下半封邮件
    await purgeMessages(env, [id]);

    throw error;
  }

  return id;
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

export function sqlDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
