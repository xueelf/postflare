import { extractAttachmentIds, IMAGE_MAX_BYTES } from './attachments';
import { chunks, DB_PARAM_LIMIT, deleteObjects } from './batch';
import { badRequest, notFound, readJson } from './http';

interface TemplatePayload {
  name: string;
  subject: string;
  body_html: string;
}

async function readTemplatePayload(
  request: Request,
): Promise<TemplatePayload | Response> {
  const payload = await readJson<{
    name?: unknown;
    subject?: unknown;
    body_html?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const subject =
    typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const body =
    typeof payload.body_html === 'string' ? payload.body_html.trim() : '';

  if (!name) {
    return badRequest('template name is empty');
  }

  if (!body) {
    return badRequest('template body is empty');
  }
  return { name, subject, body_html: body };
}

/**
 * 模板的创建与更新共用，解析负载并提取内联图片。
 */
async function parseTemplateRequest(
  request: Request,
): Promise<
  | { payload: TemplatePayload; html: string; images: ExtractedImage[] }
  | Response
> {
  const payload = await readTemplatePayload(request);

  if (payload instanceof Response) {
    return payload;
  }
  const extracted = extractDataImages(payload.body_html);

  if (typeof extracted === 'string') {
    return badRequest(extracted);
  }
  return { payload, html: extracted.html, images: extracted.images };
}

interface ExtractedImage {
  id: string;
  mimeType: string;
  filename: string;
  data: Uint8Array;
}

/**
 * 从模板正文提取 base64 内联图片，替换为应用地址并返回图片数据供存储。
 * 相同 data URL 的图片只存一份，超过上限时返回错误。
 */
export function extractDataImages(
  html: string,
): { html: string; images: ExtractedImage[] } | string {
  const ids = new Map<string, string>();
  const images: ExtractedImage[] = [];

  let error = '';

  const rewritten = html.replace(
    /data:image\/([\w.+-]+);base64,([A-Za-z0-9+/=]+)/g,
    (match, subtype: string) => {
      const existing = ids.get(match);

      if (existing) {
        return `/api/attachments/${existing}`;
      }
      const data = base64ToBytes(match.slice(match.indexOf(',') + 1));

      if (data.byteLength > IMAGE_MAX_BYTES) {
        error = 'image too large';

        return match;
      }
      const id = crypto.randomUUID();

      ids.set(match, id);

      images.push({
        id,
        mimeType: `image/${subtype}`,
        filename: `image.${subtype.replace(/\+.*$/, '')}`,
        data,
      });

      return `/api/attachments/${id}`;
    },
  );

  if (error) {
    return error;
  }
  return { html: rewritten, images };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function storeTemplateImages(
  env: Env,
  templateId: string,
  images: ExtractedImage[],
): Promise<void> {
  for (const image of images) {
    const storageKey = `attachments/templates/${templateId}/${image.id}`;

    await env.ATTACHMENTS.put(storageKey, image.data, {
      httpMetadata: { contentType: image.mimeType },
    });

    await env.DB.prepare(
      `INSERT INTO attachments (id, template_id, filename, content_type, size_bytes, storage_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        image.id,
        templateId,
        image.filename,
        image.mimeType,
        image.data.byteLength,
        storageKey,
      )
      .run();
  }
}

// 清理模板下不再被正文引用的图片连同 R2 对象，传空正文即全部清理
async function pruneTemplateImages(
  env: Env,
  templateId: string,
  html: string,
): Promise<void> {
  const referenced = new Set(extractAttachmentIds(html));
  const { results } = await env.DB.prepare(
    `SELECT id, storage_key FROM attachments WHERE template_id = ?`,
  )
    .bind(templateId)
    .all<{ id: string; storage_key: string }>();
  const stale = results.filter(row => !referenced.has(row.id));

  if (stale.length === 0) {
    return;
  }

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

export async function listTemplates(
  env: Env,
  userId: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, subject, body_html, updated_at FROM templates
     WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all();

  return Response.json(results);
}

export async function createTemplate(
  env: Env,
  request: Request,
  userId: string,
): Promise<Response> {
  const parsed = await parseTemplateRequest(request);

  if (parsed instanceof Response) {
    return parsed;
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO templates (id, user_id, name, subject, body_html) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, parsed.payload.name, parsed.payload.subject, parsed.html)
    .run();
  await storeTemplateImages(env, id, parsed.images);

  return Response.json({ id });
}

export async function updateTemplate(
  env: Env,
  id: string,
  request: Request,
  userId: string,
): Promise<Response> {
  const parsed = await parseTemplateRequest(request);

  if (parsed instanceof Response) {
    return parsed;
  }

  const updated = await env.DB.prepare(
    `UPDATE templates
     SET name = ?, subject = ?, body_html = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(parsed.payload.name, parsed.payload.subject, parsed.html, id, userId)
    .run();

  if (updated.meta.changes === 0) {
    return notFound();
  }
  await storeTemplateImages(env, id, parsed.images);
  await pruneTemplateImages(env, id, parsed.html);

  return Response.json({ ok: true });
}

export async function deleteTemplate(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const owned = await env.DB.prepare(
    'SELECT id FROM templates WHERE id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .first();

  if (!owned) {
    return notFound();
  }

  // 模板图片连同 R2 对象一并清理
  await pruneTemplateImages(env, id, '');
  await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();

  return Response.json({ ok: true });
}
