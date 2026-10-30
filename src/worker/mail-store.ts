import type { Email } from 'postal-mime';

import { D1_MAX_ROW_BYTES } from '#/limits';

import { normalizeContentId } from './attachments';
import { deleteObjects } from './batch';
import { isUniqueViolation } from './http';
import { rowBudget, sqliteRowBytes } from './row-size';

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
  const inReplyTo = normalizeMessageId(parsed.inReplyTo);
  const encoder = new TextEncoder();
  const updatedAt = sqlDate(undefined);
  // 列顺序与 messages 表一致，预算与插入共用同一份数据
  const rowValues: Array<string | number | null> = [
    id,
    userId,
    mailbox,
    direction,
    seen,
    from,
    fromName,
    to,
    subject,
    '',
    '',
    null,
    messageId ?? null,
    inReplyTo ?? null,
    parsed.references ?? null,
    rawKey,
    createdAt,
    updatedAt,
  ];
  const available = rowBudget(rowValues);
  const text = parsed.text ?? null;
  const html = parsed.html ?? null;
  const textBytes = text === null ? 0 : encoder.encode(text).length;
  const htmlBytes = html === null ? 0 : encoder.encode(html).length;
  const totalBytes = textBytes + htmlBytes;

  let textBudget: number;
  let htmlBudget: number;

  if (totalBytes <= available) {
    textBudget = textBytes;
    htmlBudget = htmlBytes;
  } else {
    textBudget = Math.floor((available * textBytes) / totalBytes);
    htmlBudget = available - textBudget;
  }

  let textValue = capBody(text, '(message truncated)', textBudget);
  let htmlValue = capBody(html, '<p>(message truncated)</p>', htmlBudget);

  // 截断后按实际记录长度复核，补上正文 serial type 变长带来的头部开销
  for (;;) {
    rowValues[9] = textValue;
    rowValues[10] = htmlValue;

    const over = sqliteRowBytes(rowValues) - D1_MAX_ROW_BYTES;

    if (over <= 0 || (textBudget === 0 && htmlBudget === 0)) {
      break;
    }

    if (textBudget >= htmlBudget) {
      textBudget = Math.max(0, textBudget - over);
    } else {
      htmlBudget = Math.max(0, htmlBudget - over);
    }
    textValue = capBody(text, '(message truncated)', textBudget);
    htmlValue = capBody(html, '<p>(message truncated)</p>', htmlBudget);
  }

  const writtenKeys: string[] = [];
  const attachmentRows: Array<{
    id: string;
    filename: string;
    contentType: string;
    contentId: string | null;
    size: number;
    storageKey: string;
  }> = [];

  try {
    // 先把本次对象全部写入 R2，失败时数据库还没有可见记录
    await env.ATTACHMENTS.put(rawKey, raw);
    writtenKeys.push(rawKey);

    for (const attachment of parsed.attachments) {
      const attachmentId = crypto.randomUUID();
      const storageKey = `attachments/${id}/${attachmentId}`;
      const content = attachment.content as ArrayBuffer;
      const contentId =
        attachment.disposition === 'attachment'
          ? null
          : normalizeContentId(attachment.contentId);

      await env.ATTACHMENTS.put(storageKey, content);
      writtenKeys.push(storageKey);

      attachmentRows.push({
        id: attachmentId,
        filename: attachment.filename ?? 'attachment',
        contentType: attachment.mimeType,
        contentId,
        size: content.byteLength,
        storageKey,
      });
    }
  } catch (error) {
    await deleteObjects(env, writtenKeys).catch(cleanupError => {
      console.error('failed to delete partial message objects', cleanupError);
    });

    throw error;
  }

  const statements = [
    env.DB.prepare(
      `INSERT INTO messages (
         id, user_id, mailbox, direction, seen, from_address, from_name,
         to_address, subject, body_text, body_html, body_source, message_id,
         in_reply_to, "references", raw_storage_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...rowValues),
    ...attachmentRows.map(attachment =>
      env.DB.prepare(
        `INSERT INTO attachments (
           id, message_id, filename, content_type, content_id, size_bytes, storage_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        attachment.id,
        id,
        attachment.filename,
        attachment.contentType,
        attachment.contentId,
        attachment.size,
        attachment.storageKey,
      ),
    ),
  ];

  try {
    // 邮件与附件元数据同批提交，成功后才出现可去重的邮件记录
    await env.DB.batch(statements);
  } catch (error) {
    await deleteObjects(env, writtenKeys).catch(cleanupError => {
      console.error('failed to delete partial message objects', cleanupError);
    });

    if (isUniqueViolation(error)) {
      return null;
    }
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
export function capBody(
  value: string | null,
  notice: string,
  budget: number,
): string | null {
  if (value === null) {
    return null;
  }
  const encoder = new TextEncoder();
  const size = encoder.encode(value).length;

  if (size <= budget) {
    return value;
  }
  const noticeBytes = encoder.encode(notice).length;

  if (budget <= noticeBytes) {
    return '';
  }

  const contentBudget = budget - noticeBytes;

  let bytes = 0;
  let end = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const width =
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;

    if (bytes + width > contentBudget) {
      break;
    }
    bytes += width;
    end += character.length;
  }

  return value.slice(0, end) + notice;
}

export function sqlDate(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
