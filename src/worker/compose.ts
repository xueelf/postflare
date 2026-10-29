import { extractAttachmentIds, replaceAttachmentUrls } from '#/attachment-url';
import {
  D1_MAX_ROW_BYTES,
  EMAIL_MAX_BYTES,
  MAX_ATTACHMENTS,
  MAX_RECIPIENTS,
  MAX_SUBJECT_LENGTH,
} from '#/limits';
import { parseRecipients, validRecipients } from '#/recipients';

import type { AuthUser } from './auth';
import { chunks, DB_PARAM_LIMIT, deleteObjects } from './batch';
import { badRequest, jsonError, notFound, readJson } from './http';
import { capBody, normalizeMessageId, sqlDate } from './mail-store';
import { messageDetail, purgeMessages } from './messages';
import { type MimeAttachment, buildRawMessage } from './mime';
import { rowTooLarge, sqliteRowBytes } from './row-size';

function subjectTooLong(subject: string): boolean {
  return subject.length > MAX_SUBJECT_LENGTH;
}

export async function composeMessage(
  env: Env,
  user: AuthUser,
  request: Request,
): Promise<Response> {
  const payload = await readJson<{
    to?: unknown;
    subject?: unknown;
    text?: unknown;
    html?: unknown;
    source?: unknown;
    draftId?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const to = typeof payload.to === 'string' ? payload.to.trim() : '';
  const subject =
    typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const html = typeof payload.html === 'string' ? payload.html : '';
  const source = typeof payload.source === 'string' ? payload.source : '';

  if (!validRecipients(to)) {
    return badRequest('invalid recipient');
  }

  if (!source.trim()) {
    return badRequest('message source is empty');
  }

  if (parseRecipients(to).length > MAX_RECIPIENTS) {
    return badRequest('too many recipients');
  }

  const id = crypto.randomUUID();
  const rawKey = `raw/${id}.eml`;

  if (subjectTooLong(subject)) {
    return badRequest('subject too long');
  }

  // 正文里的应用图片地址换成 cid，图片作为内联附件随信发出
  // 只装载属于当前用户的附件，否则拿到 id 就能把别人的图片发出去
  const inlineIds = extractAttachmentIds(html);
  const draftAttachmentIds = [
    ...new Set([...inlineIds, ...extractAttachmentIds(source)]),
  ];

  if (inlineIds.length > MAX_ATTACHMENTS) {
    return badRequest('too many attachments');
  }

  const attachments: MimeAttachment[] = [];
  const sentIds = new Set<string>();

  for (const attachmentId of inlineIds) {
    const attachment = await env.DB.prepare(
      `SELECT a.filename, a.content_type, a.storage_key
       FROM attachments a
       WHERE a.id = ?
         AND (
           EXISTS (SELECT 1 FROM messages m WHERE m.id = a.message_id AND m.user_id = ?)
           OR EXISTS (SELECT 1 FROM templates t WHERE t.id = a.template_id AND t.user_id = ?)
         )`,
    )
      .bind(attachmentId, user.id, user.id)
      .first<{ filename: string; content_type: string; storage_key: string }>();

    if (!attachment) {
      continue;
    }
    const object = await env.ATTACHMENTS.get(attachment.storage_key);

    if (!object) {
      continue;
    }
    sentIds.add(attachmentId);

    const content = await object.arrayBuffer();

    attachments.push({
      disposition: 'inline',
      contentId: attachmentId,
      filename: attachment.filename,
      type: attachment.content_type,
      content,
    });
  }

  // 没装载成功的图片不做 cid 替换，否则收件人看到的是裂图
  const sendHtml = replaceAttachmentUrls(html, id =>
    sentIds.has(id) ? `cid:${id}` : null,
  );

  const previewRaw = buildRawMessage({
    from: user.email,
    fromName: user.name,
    to,
    subject,
    text,
    html: sendHtml,
    attachments,
  });

  if (new TextEncoder().encode(previewRaw).length > EMAIL_MAX_BYTES) {
    return jsonError('message too large', 413);
  }

  const sender = { name: user.name, email: user.email };
  const result = await env.EMAIL.send({
    from: sender,
    to: parseRecipients(to),
    subject,
    text,
    html: sendHtml,
    attachments,
  });

  const messageId = normalizeMessageId(result.messageId);
  const draftId =
    typeof payload.draftId === 'string' && payload.draftId
      ? payload.draftId
      : null;

  const inlineSet = new Set(draftAttachmentIds);

  let staleDraftKeys: string[] = [];
  let sourceKey: string | null = null;
  let archived = true;

  try {
    if (draftId) {
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.storage_key
         FROM attachments a
         JOIN messages m ON m.id = a.message_id
         WHERE m.id = ? AND m.user_id = ? AND m.mailbox = 'drafts'`,
      )
        .bind(draftId, user.id)
        .all<{ id: string; storage_key: string }>();

      staleDraftKeys = results
        .filter(row => !inlineSet.has(row.id))
        .map(row => row.storage_key);
    }

    const raw = buildRawMessage({
      from: sender.email,
      fromName: sender.name,
      to,
      subject,
      text,
      html: sendHtml,
      attachments,
      messageId: messageId ? `<${messageId}>` : undefined,
    });

    await env.ATTACHMENTS.put(rawKey, raw);

    // Message-ID 由投递返回，归档行必须保存并纳入整行预算
    const archivedAt = sqlDate(undefined);
    const encoder = new TextEncoder();
    const sentValues: Array<string | number | null> = [
      id,
      user.id,
      'sent',
      'outbound',
      1,
      user.email,
      '',
      to,
      subject,
      text,
      html,
      source,
      messageId,
      null,
      null,
      rawKey,
      archivedAt,
      archivedAt,
    ];

    let over = sqliteRowBytes(sentValues) - D1_MAX_ROW_BYTES;

    if (over > 0 && source) {
      // 先把完整源码放进 R2，再按原始纯文本和 HTML 重新计算预算
      sourceKey = `source/${id}.inky`;
      await env.ATTACHMENTS.put(sourceKey, source);
      sentValues[11] = null;
      over = sqliteRowBytes(sentValues) - D1_MAX_ROW_BYTES;
    }

    if (over > 0) {
      // 源码外置后仍然超限，才让可再生的纯文本和展示 HTML 让出预算
      for (const index of [9, 10]) {
        const value = sentValues[index];

        if (typeof value !== 'string' || !value) {
          continue;
        }

        const bytes = encoder.encode(value).length;
        const target = Math.max(0, bytes - over);

        sentValues[index] = capBody(value, '(message truncated)', target);
        over = sqliteRowBytes(sentValues) - D1_MAX_ROW_BYTES;

        if (over <= 0) {
          break;
        }
      }
    }

    const statements = [
      env.DB.prepare(
        `INSERT INTO messages (
           id, user_id, mailbox, direction, seen, from_address, from_name,
           to_address, subject, body_text, body_html, body_source, message_id,
           in_reply_to, "references", raw_storage_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(...sentValues),
    ];

    if (draftId) {
      if (draftAttachmentIds.length > 0) {
        const placeholders = draftAttachmentIds.map(() => '?').join(', ');

        statements.push(
          env.DB.prepare(
            `UPDATE attachments SET message_id = ?
             WHERE message_id = ? AND id IN (${placeholders})
               AND EXISTS (
                 SELECT 1 FROM messages
                 WHERE id = ? AND user_id = ? AND mailbox = 'drafts'
               )`,
          ).bind(id, draftId, ...draftAttachmentIds, draftId, user.id),
        );
      }

      statements.push(
        env.DB.prepare(
          `DELETE FROM messages
           WHERE id = ? AND user_id = ? AND mailbox = 'drafts'`,
        ).bind(draftId, user.id),
      );
    }

    await env.DB.batch(statements);
  } catch (error) {
    archived = false;
    await env.ATTACHMENTS.delete(rawKey).catch(() => {});

    if (sourceKey) {
      await env.ATTACHMENTS.delete(sourceKey).catch(() => {});
    }
    console.error('failed to archive sent message', error);
  }

  if (archived) {
    try {
      await deleteObjects(env, staleDraftKeys);
    } catch (error) {
      console.error('failed to delete stale draft attachments', error);
    }
  }

  return Response.json(
    { id, archived },
    { status: 201, headers: { Location: `/api/messages/${id}` } },
  );
}

async function pruneDraftImages(
  env: Env,
  draftId: string,
  html: string,
  source: string,
  pruneIds: string[],
): Promise<void> {
  const referenced = new Set([
    ...extractAttachmentIds(html),
    ...extractAttachmentIds(source),
  ]);
  const ids = [...new Set(pruneIds)];

  if (ids.length === 0) {
    return;
  }

  const rows: Array<{ id: string; storage_key: string }> = [];

  for (const batch of chunks(ids, DB_PARAM_LIMIT - 1)) {
    const placeholders = batch.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id, storage_key FROM attachments
       WHERE message_id = ? AND id IN (${placeholders})`,
    )
      .bind(draftId, ...batch)
      .all<{ id: string; storage_key: string }>();

    rows.push(...results);
  }

  const stale = rows.filter(row => !referenced.has(row.id));

  if (stale.length === 0) {
    return;
  }

  // 先删 R2 对象，再删数据库行；失败时保留元数据，下一次保存可重试
  await deleteObjects(
    env,
    stale.map(row => row.storage_key),
  );

  for (const batch of chunks(
    stale.map(row => row.id),
    DB_PARAM_LIMIT,
  )) {
    const placeholders = batch.map(() => '?').join(', ');

    await env.DB.prepare(
      `DELETE FROM attachments WHERE id IN (${placeholders})`,
    )
      .bind(...batch)
      .run();
  }
}

export async function saveDraft(
  env: Env,
  user: AuthUser,
  request: Request,
  id?: string,
): Promise<Response> {
  const payload = await readJson<{
    to?: unknown;
    subject?: unknown;
    text?: unknown;
    html?: unknown;
    source?: unknown;
    allowEmpty?: unknown;
    prune?: unknown;
    pruneIds?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const to = typeof payload.to === 'string' ? payload.to.trim() : '';
  const subject =
    typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const html = typeof payload.html === 'string' ? payload.html : '';
  const source = typeof payload.source === 'string' ? payload.source : '';
  const allowEmpty = payload.allowEmpty === true;
  const prune = payload.prune === true;

  let pruneIds: string[] = [];

  if (payload.pruneIds !== undefined) {
    if (
      !Array.isArray(payload.pruneIds) ||
      payload.pruneIds.some(value => typeof value !== 'string')
    ) {
      return badRequest('invalid prune ids');
    }
    pruneIds = [...new Set(payload.pruneIds)];
  }

  if (!id && !allowEmpty && !to && !subject && !text && !source.trim()) {
    return badRequest('draft is empty');
  }

  if (parseRecipients(to).length > MAX_RECIPIENTS) {
    return badRequest('too many recipients');
  }

  const rowId = id ?? crypto.randomUUID();

  if (
    rowTooLarge([
      rowId,
      user.id,
      'drafts',
      'outbound',
      0,
      user.email,
      '',
      to,
      subject,
      text,
      html,
      source,
      '',
      '',
      '',
      '',
      '0000-00-00 00:00:00',
      '0000-00-00 00:00:00',
    ])
  ) {
    return badRequest('message too large');
  }

  if (subjectTooLong(subject)) {
    return badRequest('subject too long');
  }

  if (id) {
    const saved = await env.DB.prepare(
      `UPDATE messages
       SET to_address = ?, subject = ?, body_text = ?, body_html = ?,
           body_source = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND mailbox = 'drafts'`,
    )
      .bind(to, subject, text, html, source, id, user.id)
      .run();

    if (saved.meta.changes === 0) {
      return notFound();
    }

    // 只清理本次稳定快照能够证明已失去引用的附件，避免删除其它标签页的新上传
    if (prune) {
      await pruneDraftImages(env, id, html, source, pruneIds).catch(error => {
        console.error('failed to prune draft images', error);
      });
    }

    const detail = await messageDetail(env, id, user.id);

    return Response.json({ id, message: detail });
  }

  await env.DB.prepare(
    `INSERT INTO messages (
       id, user_id, mailbox, direction, from_address, to_address, subject,
       body_text, body_html, body_source
     ) VALUES (?, ?, 'drafts', 'outbound', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(rowId, user.id, user.email, to, subject, text, html, source)
    .run();

  const detail = await messageDetail(env, rowId, user.id);

  return Response.json(
    { id: rowId, message: detail },
    { status: 201, headers: { Location: `/api/drafts/${rowId}` } },
  );
}

export async function discardDraft(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const draft = await env.DB.prepare(
    `SELECT id FROM messages WHERE id = ? AND mailbox = 'drafts' AND user_id = ?`,
  )
    .bind(id, userId)
    .first<{ id: string }>();

  if (!draft) {
    return notFound();
  }

  await purgeMessages(env, [id]);

  return Response.json({ ok: true });
}
