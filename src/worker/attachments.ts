import { replaceResourceUrls } from '#/attachment-url';
import { EMAIL_MAX_BYTES, MAX_ATTACHMENTS } from '#/limits';

import { badRequest, jsonError, notFound } from './http';
import { type MimeAttachment, buildRawMessage } from './mime';

export interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}

export interface CidAttachment {
  id: string;
  content_id: string | null;
}

/** 去掉 Content-ID 头可能带上的尖括号 */
export function normalizeContentId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim().replace(/^</, '').replace(/>$/, '').trim();

  return trimmed || null;
}

/**
 * 把正文里的 cid: 引用换成附件地址，收件后内联图片才能显示。
 */
export function replaceCidImages(
  html: string,
  attachments: CidAttachment[],
): string {
  if (!html || attachments.length === 0) {
    return html;
  }

  const byContentId = new Map<string, string>();

  for (const attachment of attachments) {
    const contentId = normalizeContentId(attachment.content_id);

    if (contentId) {
      byContentId.set(contentId, attachment.id);
    }
  }

  if (byContentId.size === 0) {
    return html;
  }

  const resolve = (raw: string): string | null => {
    let contentId = raw;

    try {
      contentId = decodeURIComponent(raw);
    } catch {
      // 保留原值，按未编码的 cid 匹配
    }

    const id = byContentId.get(normalizeContentId(contentId) ?? '');

    return id ? `/api/attachments/${id}` : null;
  };

  return replaceResourceUrls(html, url => {
    if (url.slice(0, 4).toLowerCase() !== 'cid:') {
      return null;
    }

    return resolve(url.slice(4));
  });
}

export async function getAttachment(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const attachment = await env.DB.prepare(
    `SELECT a.filename, a.content_type, a.storage_key
     FROM attachments a
     WHERE a.id = ?
       AND (
         EXISTS (SELECT 1 FROM messages m WHERE m.id = a.message_id AND m.user_id = ?)
         OR EXISTS (SELECT 1 FROM templates t WHERE t.id = a.template_id AND t.user_id = ?)
       )`,
  )
    .bind(id, userId, userId)
    .first<{ filename: string; content_type: string; storage_key: string }>();

  if (!attachment) {
    return notFound();
  }

  const object = await env.ATTACHMENTS.get(attachment.storage_key);

  if (!object) {
    return notFound();
  }

  // 同 inbound，workers-types 与 DOM 库声明的 ReadableStream 类型不同，运行时一致
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'Content-Type': attachment.content_type,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    },
  });
}

/**
 * 上传正文内联图片。图片先写入 R2，再挂到草稿或模板。
 * 上传入口按最终 MIME 大小提前校验，避免用户编辑完成后才在发送阶段失败。
 */
export async function uploadAttachment(
  env: Env,
  request: Request,
  user: { id: string; email: string },
): Promise<Response> {
  const form = await request.formData().catch(() => null);

  if (!form) {
    return badRequest('invalid form data');
  }

  const file = form.get('file');
  const messageId = form.get('messageId');
  const templateId = form.get('templateId');
  const sourceRaw = form.get('sourceIds');
  const textValue = form.get('text');
  const htmlValue = form.get('html');
  const subjectValue = form.get('subject');

  if (!(file instanceof File)) {
    return badRequest('file is required');
  }

  if (
    typeof textValue !== 'string' ||
    typeof htmlValue !== 'string' ||
    typeof subjectValue !== 'string'
  ) {
    return badRequest('missing snapshot');
  }

  let sourceIds: string[] = [];

  if (typeof sourceRaw === 'string' && sourceRaw) {
    try {
      const parsed: unknown = JSON.parse(sourceRaw);

      if (
        !Array.isArray(parsed) ||
        parsed.some(value => typeof value !== 'string')
      ) {
        return badRequest('invalid source ids');
      }
      sourceIds = [...new Set(parsed)];
    } catch {
      return badRequest('invalid source ids');
    }
  }

  if (!file.type.startsWith('image/')) {
    return badRequest('unsupported type');
  }

  if (file.size > EMAIL_MAX_BYTES) {
    return jsonError('message too large', 413);
  }

  const messageOwnerId = typeof messageId === 'string' ? messageId.trim() : '';
  const templateOwnerId =
    typeof templateId === 'string' ? templateId.trim() : '';
  const hasMessage = messageOwnerId.length > 0;
  const hasTemplate = templateOwnerId.length > 0;

  if (hasMessage === hasTemplate) {
    return badRequest(
      hasMessage ? 'multiple attachment owners' : 'missing attachment owner',
    );
  }

  const bodyText = textValue;
  const bodyHtml = htmlValue;
  const subject = subjectValue;

  let existing: Array<{
    id: string;
    filename: string;
    content_type: string;
    content_id: string | null;
    storage_key: string;
  }> = [];

  if (hasMessage) {
    const draft = await env.DB.prepare(
      `SELECT id FROM messages
       WHERE id = ? AND mailbox = 'drafts' AND user_id = ?`,
    )
      .bind(messageOwnerId, user.id)
      .first<{ id: string }>();

    if (!draft) {
      return notFound();
    }

    const { results } = await env.DB.prepare(
      `SELECT id, filename, content_type, content_id, storage_key
       FROM attachments WHERE message_id = ?`,
    )
      .bind(messageOwnerId)
      .all<(typeof existing)[number]>();

    existing = results;
  } else {
    const template = await env.DB.prepare(
      `SELECT id FROM templates WHERE id = ? AND user_id = ?`,
    )
      .bind(templateOwnerId, user.id)
      .first<{ id: string }>();

    if (!template) {
      return notFound();
    }

    const { results } = await env.DB.prepare(
      `SELECT id, filename, content_type, content_id, storage_key
       FROM attachments WHERE template_id = ?`,
    )
      .bind(templateOwnerId)
      .all<(typeof existing)[number]>();

    existing = results;
  }

  // 额度以本次请求携带的正文、主题和附件引用为准，不读数据库里的旧正文
  const referenced = new Set(sourceIds);

  existing = existing.filter(row => referenced.has(row.id));

  if (existing.length >= MAX_ATTACHMENTS) {
    return jsonError('too many attachments', 400);
  }

  const id = crypto.randomUUID();
  const ownerColumn = hasMessage ? 'message_id' : 'template_id';
  const ownerId = hasMessage ? messageOwnerId : templateOwnerId;
  const storageKey = `attachments/${ownerId}/${id}`;
  const content = await file.arrayBuffer();
  const attachments: MimeAttachment[] = [];

  for (const row of existing) {
    const object = await env.ATTACHMENTS.get(row.storage_key);

    if (!object) {
      continue;
    }
    const content = await object.arrayBuffer();

    if (row.content_id) {
      attachments.push({
        disposition: 'inline',
        contentId: row.content_id,
        filename: row.filename,
        type: row.content_type,
        content,
      });
    } else {
      attachments.push({
        disposition: 'attachment',
        filename: row.filename,
        type: row.content_type,
        content,
      });
    }
  }

  attachments.push({
    filename: file.name,
    type: file.type,
    content,
    disposition: 'inline',
    contentId: id,
  });

  const raw = buildRawMessage({
    from: user.email,
    to: user.email,
    subject,
    text: bodyText,
    html: bodyHtml,
    attachments,
  });

  if (new TextEncoder().encode(raw).length > EMAIL_MAX_BYTES) {
    return jsonError('message too large', 413);
  }

  await env.ATTACHMENTS.put(storageKey, content, {
    httpMetadata: { contentType: file.type },
  });

  try {
    await env.DB.prepare(
      `INSERT INTO attachments
         (id, ${ownerColumn}, filename, content_type, size_bytes, storage_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, ownerId, file.name, file.type, file.size, storageKey)
      .run();
  } catch (error) {
    await env.ATTACHMENTS.delete(storageKey);

    throw error;
  }

  return Response.json(
    { id },
    { status: 201, headers: { Location: `/api/attachments/${id}` } },
  );
}
