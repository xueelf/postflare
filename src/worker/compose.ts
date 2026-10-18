import { ATTACHMENT_URL_RE, attachmentIdsIn } from './attachments';
import type { AuthUser } from './auth';
import { chunks, DB_PARAM_LIMIT } from './batch';
import { badRequest, notFound, readJson } from './http';
import { normalizeMessageId } from './inbound';
import { purgeMessages } from './messages';

const RECIPIENT_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function validRecipients(value: string): boolean {
  return value.split(',').every(part => RECIPIENT_PATTERN.test(part.trim()));
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

  if (!validRecipients(to)) {
    return badRequest('invalid recipient');
  }

  if (!text && !html.includes('<img')) {
    return badRequest('message text is empty');
  }

  // 空主题照原样存，界面按当前语言显示「无主题」
  const cleanSubject = subject;
  // 内联图片：正文里的应用图片地址换成 cid，对象作为内联附件随信发出。
  // 只装载属于当前用户的附件，否则拿到 id 就能把别人的图片发出去
  const inlineIds = attachmentIdsIn(html);
  const attachments: EmailAttachment[] = [];
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

    attachments.push({
      disposition: 'inline',
      contentId: attachmentId,
      filename: attachment.filename,
      type: attachment.content_type,
      content: await object.arrayBuffer(),
    });
  }

  const result = await env.EMAIL.send({
    from: user.email,
    to,
    subject: cleanSubject,
    text,
    // 没装载成功的图片不做 cid 替换，否则收件人看到的是裂图
    html: html.replace(ATTACHMENT_URL_RE, (match: string, id: string) =>
      sentIds.has(id) ? `cid:${id}` : match,
    ),
    attachments,
  });

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO messages (
       id, user_id, mailbox, direction, seen, from_address, to_address, subject, body_text, body_html, message_id
     ) VALUES (?, ?, 'sent', 'outbound', 1, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      user.email,
      to,
      cleanSubject,
      text,
      html,
      normalizeMessageId(result.messageId),
    )
    .run();

  if (typeof payload.draftId === 'string' && payload.draftId) {
    const draftId = payload.draftId;
    const draft = await env.DB.prepare(
      `SELECT id FROM messages WHERE id = ? AND mailbox = 'drafts' AND user_id = ?`,
    )
      .bind(draftId, user.id)
      .first<{ id: string }>();

    if (draft) {
      // 正文引用的内联图片随发出的邮件保留（按绑定参数上限分块）
      if (inlineIds.length > 0) {
        for (const batch of chunks(inlineIds, DB_PARAM_LIMIT - 2)) {
          const placeholders = batch.map(() => '?').join(', ');

          await env.DB.prepare(
            `UPDATE attachments SET message_id = ? WHERE message_id = ? AND id IN (${placeholders})`,
          )
            .bind(id, draftId, ...batch)
            .run();
        }
      }
      // 其余草稿附件连同 R2 对象随草稿一并清理
      await purgeMessages(env, [draftId]);
    }
  }

  return Response.json({ id });
}

export async function saveDraft(
  env: Env,
  user: AuthUser,
  request: Request,
): Promise<Response> {
  const payload = await readJson<{
    id?: unknown;
    to?: unknown;
    subject?: unknown;
    text?: unknown;
    html?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const to = typeof payload.to === 'string' ? payload.to.trim() : '';
  const subject =
    typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  const html = typeof payload.html === 'string' ? payload.html : '';

  if (!to && !subject && !text && !html.includes('<img')) {
    return badRequest('draft is empty');
  }

  const id =
    typeof payload.id === 'string' && payload.id
      ? payload.id
      : crypto.randomUUID();
  // 归属写进 upsert 条件：命中的是别人的邮件或不是草稿时，既不改也不新建
  const saved = await env.DB.prepare(
    `INSERT INTO messages (
       id, user_id, mailbox, direction, from_address, to_address, subject, body_text, body_html
     ) VALUES (?, ?, 'drafts', 'outbound', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       to_address = excluded.to_address,
       subject = excluded.subject,
       body_text = excluded.body_text,
       body_html = excluded.body_html,
       updated_at = datetime('now')
     WHERE messages.user_id = excluded.user_id AND messages.mailbox = 'drafts'`,
  )
    .bind(id, user.id, user.email, to, subject, text, html)
    .run();

  if (saved.meta.changes === 0) {
    return notFound();
  }

  return Response.json({ id });
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
