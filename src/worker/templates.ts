import { extractAttachmentIds, replaceAttachmentUrls } from '#/attachment-url';
import { MAX_SUBJECT_LENGTH, MAX_TEMPLATE_BYTES } from '#/limits';

import { chunks, DB_PARAM_LIMIT, deleteObjects } from './batch';
import { badRequest, jsonError, notFound, readJson } from './http';
import { rowTooLarge } from './row-size';

interface TemplatePayload {
  name: string;
  subject: string;
  body_html: string;
  body_source: string;
  pruneIds: string[];
}

export function createTemplatePayload(
  name: string,
  subject: string,
  body: string,
  source: string,
  pruneIds: string[] = [],
): TemplatePayload | Response {
  if (!name) {
    return badRequest('template name is empty');
  }

  if (subject.length > MAX_SUBJECT_LENGTH) {
    return badRequest('subject too long');
  }
  return {
    name,
    subject,
    body_html: body,
    body_source: source,
    pruneIds,
  };
}

export function parseTemplatePayload(payload: {
  name?: unknown;
  subject?: unknown;
  body_html?: unknown;
  body_source?: unknown;
  pruneIds?: unknown;
}): TemplatePayload | Response {
  if (
    typeof payload.name !== 'string' ||
    typeof payload.subject !== 'string' ||
    typeof payload.body_html !== 'string' ||
    typeof payload.body_source !== 'string'
  ) {
    return badRequest('invalid template payload');
  }

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

  return createTemplatePayload(
    payload.name.trim(),
    payload.subject.trim(),
    payload.body_html.trim(),
    payload.body_source.trim(),
    pruneIds,
  );
}

async function readTemplatePayload(
  request: Request,
): Promise<TemplatePayload | Response> {
  const payload = await readJson<{
    name?: unknown;
    subject?: unknown;
    body_html?: unknown;
    body_source?: unknown;
    pruneIds?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }

  return parseTemplatePayload(payload);
}

async function templateAttachments(
  env: Env,
  templateId: string,
): Promise<Array<{ id: string; storage_key: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT id, storage_key FROM attachments WHERE template_id = ?`,
  )
    .bind(templateId)
    .all<{ id: string; storage_key: string }>();

  return results;
}

async function deleteTemplateData(env: Env, id: string): Promise<void> {
  // 先删 R2 对象，再删数据库行；R2 失败时元数据还在，可以重试
  const attachments = await templateAttachments(env, id);

  await deleteObjects(
    env,
    attachments.map(row => row.storage_key),
  );

  await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();
}

// 只清理本次保存能够证明已失去引用的模板图片，避免删除其它标签页的新上传
async function pruneTemplateImages(
  env: Env,
  templateId: string,
  html: string,
  source: string,
  pruneIds: string[],
): Promise<void> {
  const referenced = new Set([
    ...extractAttachmentIds(html),
    ...extractAttachmentIds(source),
  ]);
  const known = new Set(pruneIds);
  const results = await templateAttachments(env, templateId);
  const stale = results.filter(
    row => known.has(row.id) && !referenced.has(row.id),
  );

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
    `SELECT id, name, subject, body_html, body_source, updated_at
     FROM templates
     WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all();

  return Response.json(results);
}

async function parseTemplateImport(
  request: Request,
): Promise<TemplatePayload | Response> {
  const form = await request.formData().catch(() => null);

  if (!form) {
    return badRequest('invalid form data');
  }

  const file = form.get('file');
  const nameEntry = form.get('name');
  const bodyEntry = form.get('body_html');
  const name = typeof nameEntry === 'string' ? nameEntry : '';
  const body = typeof bodyEntry === 'string' ? bodyEntry : '';

  if (!(file instanceof File)) {
    return badRequest('template file is required');
  }

  if (!file.name.toLowerCase().endsWith('.inky')) {
    return jsonError('unsupported template file', 415);
  }

  if (file.size > MAX_TEMPLATE_BYTES) {
    return jsonError('template file too large', 413);
  }

  const source = (await file.text()).trim();

  return createTemplatePayload(name.trim(), name.trim(), body.trim(), source);
}

export function templateRowTooLarge(
  id: string,
  userId: string,
  payload: TemplatePayload,
): boolean {
  return rowTooLarge([
    id,
    userId,
    payload.name,
    payload.subject,
    payload.body_html,
    payload.body_source,
    '0000-00-00 00:00:00',
    '0000-00-00 00:00:00',
  ]);
}

async function copyTemplateAttachments(
  env: Env,
  userId: string,
  templateId: string,
  bodyHtml: string,
  bodySource: string,
): Promise<{ bodyHtml: string; bodySource: string } | Response> {
  const ids = new Set([
    ...extractAttachmentIds(bodyHtml),
    ...extractAttachmentIds(bodySource),
  ]);

  if (ids.size === 0) {
    return { bodyHtml, bodySource };
  }

  const replacements = new Map<string, string>();

  for (const id of ids) {
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
      return badRequest('attachment not found');
    }

    const object = await env.ATTACHMENTS.get(attachment.storage_key);

    if (!object) {
      return badRequest('attachment not found');
    }

    const newId = crypto.randomUUID();
    const storageKey = `attachments/${templateId}/${newId}`;

    await env.ATTACHMENTS.put(storageKey, object.body, {
      httpMetadata: { contentType: attachment.content_type },
    });

    try {
      await env.DB.prepare(
        `INSERT INTO attachments
           (id, template_id, filename, content_type, size_bytes, storage_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          newId,
          templateId,
          attachment.filename,
          attachment.content_type,
          object.size,
          storageKey,
        )
        .run();
    } catch (error) {
      await env.ATTACHMENTS.delete(storageKey).catch(() => {});

      throw error;
    }

    replacements.set(id, newId);
  }

  const rewrite = (html: string) =>
    replaceAttachmentUrls(html, id => {
      const next = replacements.get(id);

      return next ? `/api/attachments/${next}` : null;
    });

  return {
    bodyHtml: rewrite(bodyHtml),
    bodySource: rewrite(bodySource),
  };
}

async function insertTemplate(
  env: Env,
  userId: string,
  payload: TemplatePayload,
  id = crypto.randomUUID(),
): Promise<string | Response> {
  if (templateRowTooLarge(id, userId, payload)) {
    return jsonError('template too large', 413);
  }

  await env.DB.prepare(
    `INSERT INTO templates (
       id, user_id, name, subject, body_html, body_source
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      payload.name,
      payload.subject,
      payload.body_html,
      payload.body_source,
    )
    .run();

  return id;
}

function createdTemplate(id: string): Response {
  return Response.json(
    { id },
    { status: 201, headers: { Location: `/api/templates/${id}` } },
  );
}

/**
 * 导入 .inky 文件。文件由服务端读取和校验，客户端只提交编译后的 HTML。
 */
export async function importTemplate(
  env: Env,
  request: Request,
  userId: string,
): Promise<Response> {
  const parsed = await parseTemplateImport(request);

  if (parsed instanceof Response) {
    return parsed;
  }

  const id = await insertTemplate(env, userId, parsed);

  if (id instanceof Response) {
    return id;
  }
  return createdTemplate(id);
}

export async function createTemplate(
  env: Env,
  request: Request,
  userId: string,
): Promise<Response> {
  const parsed = await readTemplatePayload(request);

  if (parsed instanceof Response) {
    return parsed;
  }

  const id = crypto.randomUUID();
  const inserted = await insertTemplate(env, userId, parsed, id);

  if (inserted instanceof Response) {
    return inserted;
  }

  try {
    const copied = await copyTemplateAttachments(
      env,
      userId,
      id,
      parsed.body_html,
      parsed.body_source,
    );

    if (copied instanceof Response) {
      try {
        await deleteTemplateData(env, id);
      } catch (error) {
        console.error('failed to clean up template after copy error', error);
      }

      return copied;
    }

    if (
      copied.bodyHtml !== parsed.body_html ||
      copied.bodySource !== parsed.body_source
    ) {
      await env.DB.prepare(
        `UPDATE templates SET body_html = ?, body_source = ?
         WHERE id = ? AND user_id = ?`,
      )
        .bind(copied.bodyHtml, copied.bodySource, id, userId)
        .run();
    }
  } catch (error) {
    await deleteTemplateData(env, id).catch(() => {});

    throw error;
  }

  return createdTemplate(id);
}

export async function updateTemplate(
  env: Env,
  id: string,
  request: Request,
  userId: string,
): Promise<Response> {
  const parsed = await readTemplatePayload(request);

  if (parsed instanceof Response) {
    return parsed;
  }

  if (templateRowTooLarge(id, userId, parsed)) {
    return jsonError('template too large', 413);
  }

  const updated = await env.DB.prepare(
    `UPDATE templates
     SET name = ?, subject = ?, body_html = ?, body_source = ?,
         updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      parsed.name,
      parsed.subject,
      parsed.body_html,
      parsed.body_source,
      id,
      userId,
    )
    .run();

  if (updated.meta.changes === 0) {
    return notFound();
  }
  await pruneTemplateImages(
    env,
    id,
    parsed.body_html,
    parsed.body_source,
    parsed.pruneIds,
  );

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

  await deleteTemplateData(env, id);

  return Response.json({ ok: true });
}
