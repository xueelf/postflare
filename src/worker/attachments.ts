import { badRequest, notFound } from './http';

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}

// 正文里引用内联图片的应用地址
export const ATTACHMENT_URL_RE = /\/api\/attachments\/([\w-]+)/g;

export function extractAttachmentIds(html: string): string[] {
  const ids = new Set<string>();

  for (const match of html.matchAll(ATTACHMENT_URL_RE)) {
    if (match[1]) {
      ids.add(match[1]);
    }
  }
  return [...ids];
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
 * 上传正文内联图片，存入 R2 并挂在草稿邮件下。
 */
export async function uploadAttachment(
  env: Env,
  request: Request,
  userId: string,
): Promise<Response> {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return badRequest('invalid form data');
  }
  const file = form.get('file');
  const messageId = form.get('messageId');

  if (!(file instanceof File) || typeof messageId !== 'string') {
    return badRequest('invalid upload');
  }

  if (!file.type.startsWith('image/')) {
    return badRequest('unsupported type');
  }

  if (file.size > IMAGE_MAX_BYTES) {
    return Response.json({ error: 'file too large' }, { status: 413 });
  }

  const draft = await env.DB.prepare(
    `SELECT id FROM messages WHERE id = ? AND mailbox = 'drafts' AND user_id = ?`,
  )
    .bind(messageId, userId)
    .first<{ id: string }>();

  if (!draft) {
    return Response.json({ error: 'draft not found' }, { status: 404 });
  }

  const id = crypto.randomUUID();
  const storageKey = `attachments/${messageId}/${id}`;

  await env.ATTACHMENTS.put(storageKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  await env.DB.prepare(
    `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, storage_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, messageId, file.name, file.type, file.size, storageKey)
    .run();

  return Response.json({ id });
}
