import type { AttachmentRow } from './attachments';
import { chunks, DB_PARAM_LIMIT, deleteObjects } from './batch';
import { badRequest, notFound, readJson } from './http';

const LIST_LIMIT = 100;
const MAILBOXES = ['inbox', 'sent', 'drafts', 'spam', 'trash'];
const MOVE_TARGETS = ['inbox', 'sent', 'spam', 'trash'];
const EMPTY_TARGETS = ['spam', 'trash'];

interface MessageListRow {
  id: string;
  mailbox: string;
  direction: string;
  seen: number;
  from_address: string;
  from_name: string;
  to_address: string;
  subject: string;
  created_at: string;
  updated_at: string;
}

export async function listMessages(
  env: Env,
  url: URL,
  userId: string,
): Promise<Response> {
  const mailbox = url.searchParams.get('mailbox') ?? 'inbox';

  if (!MAILBOXES.includes(mailbox)) {
    return badRequest('invalid mailbox');
  }

  const query = url.searchParams.get('q')?.trim() ?? '';
  // 用 instr 做字面子串匹配，LIKE 的模式有 50 字节上限，且转义通配符后长度会翻倍
  const searchClause = query
    ? `AND (instr(lower(subject), lower(?)) > 0
            OR instr(lower(from_address), lower(?)) > 0
            OR instr(lower(to_address), lower(?)) > 0
            OR instr(lower(body_text), lower(?)) > 0)`
    : '';
  const order = mailbox === 'drafts' ? 'updated_at' : 'created_at';

  const statement = env.DB.prepare(
    `SELECT id, mailbox, direction, seen, from_address, from_name, to_address, subject,
            created_at, updated_at
     FROM messages
     WHERE user_id = ? AND mailbox = ? ${searchClause}
     ORDER BY ${order} DESC, rowid DESC
     LIMIT ${LIST_LIMIT}`,
  );
  const bound = query
    ? statement.bind(userId, mailbox, query, query, query, query)
    : statement.bind(userId, mailbox);

  const { results } = await bound.all<MessageListRow>();

  return Response.json(results);
}

interface MessageRow {
  id: string;
  mailbox: string;
  direction: string;
  seen: number;
  from_address: string;
  from_name: string;
  to_address: string;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  created_at: string;
  updated_at: string;
}

export async function getMessage(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const message = await env.DB.prepare(
    `SELECT id, mailbox, direction, seen, from_address, from_name, to_address, subject,
            body_text, body_html, created_at, updated_at
     FROM messages
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, userId)
    .first<MessageRow>();

  if (!message) {
    return notFound();
  }

  const { results: attachments } = await env.DB.prepare(
    `SELECT id, filename, content_type, size_bytes
     FROM attachments
     WHERE message_id = ?`,
  )
    .bind(id)
    .all<AttachmentRow>();

  return Response.json({ ...message, attachments });
}

export async function markMessageRead(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const updated = await env.DB.prepare(
    'UPDATE messages SET seen = 1 WHERE id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .run();

  if (updated.meta.changes === 0) {
    return notFound();
  }

  return Response.json({ ok: true });
}

export async function moveMessage(
  env: Env,
  id: string,
  userId: string,
  request: Request,
): Promise<Response> {
  const payload = await readJson<{ mailbox?: unknown }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const mailbox = typeof payload.mailbox === 'string' ? payload.mailbox : '';

  if (!MOVE_TARGETS.includes(mailbox)) {
    return badRequest('invalid mailbox');
  }

  const moved = await env.DB.prepare(
    `UPDATE messages SET mailbox = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(mailbox, id, userId)
    .run();

  if (moved.meta.changes === 0) {
    return notFound();
  }

  return Response.json({ ok: true });
}

export async function purgeMessages(env: Env, ids: string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const keys: string[] = [];

  for (const batch of chunks(ids, DB_PARAM_LIMIT)) {
    const placeholders = batch.map(() => '?').join(', ');
    const { results: attachments } = await env.DB.prepare(
      `SELECT storage_key FROM attachments WHERE message_id IN (${placeholders})`,
    )
      .bind(...batch)
      .all<{ storage_key: string }>();
    const { results: messages } = await env.DB.prepare(
      `SELECT raw_storage_key FROM messages WHERE id IN (${placeholders})`,
    )
      .bind(...batch)
      .all<{ raw_storage_key: string | null }>();

    keys.push(
      ...attachments.map(row => row.storage_key),
      ...messages.flatMap(row =>
        row.raw_storage_key ? [row.raw_storage_key] : [],
      ),
    );
  }

  await deleteObjects(env, keys);

  for (const batch of chunks(ids, DB_PARAM_LIMIT)) {
    const placeholders = batch.map(() => '?').join(', ');

    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM attachments WHERE message_id IN (${placeholders})`,
      ).bind(...batch),
      env.DB.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).bind(
        ...batch,
      ),
    ]);
  }

  return ids.length;
}

export async function purgeMessage(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const owned = await env.DB.prepare(
    'SELECT id FROM messages WHERE id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .first();

  if (!owned) {
    return notFound();
  }

  await purgeMessages(env, [id]);

  return Response.json({ ok: true });
}

export async function emptyMailbox(
  env: Env,
  url: URL,
  userId: string,
): Promise<Response> {
  const mailbox = url.searchParams.get('mailbox') ?? '';

  if (!EMPTY_TARGETS.includes(mailbox)) {
    return badRequest('invalid mailbox');
  }

  const { results } = await env.DB.prepare(
    'SELECT id FROM messages WHERE mailbox = ? AND user_id = ?',
  )
    .bind(mailbox, userId)
    .all<{ id: string }>();

  const purged = await purgeMessages(
    env,
    results.map(row => row.id),
  );

  return Response.json({ purged });
}

/**
 * 清空一个用户的全部邮件、模板与 R2 对象，供删除账号使用。
 */
export async function purgeUserData(env: Env, userId: string): Promise<void> {
  // 模板图片先按子查询取 key 删 R2，再删行，避免逐模板 N+1
  const { results: templateAttachments } = await env.DB.prepare(
    `SELECT storage_key FROM attachments
     WHERE template_id IN (SELECT id FROM templates WHERE user_id = ?)`,
  )
    .bind(userId)
    .all<{ storage_key: string }>();

  await deleteObjects(
    env,
    templateAttachments.map(row => row.storage_key),
  );

  await env.DB.prepare(
    `DELETE FROM attachments
     WHERE template_id IN (SELECT id FROM templates WHERE user_id = ?)`,
  )
    .bind(userId)
    .run();

  const { results: messages } = await env.DB.prepare(
    'SELECT id FROM messages WHERE user_id = ?',
  )
    .bind(userId)
    .all<{ id: string }>();

  await purgeMessages(
    env,
    messages.map(row => row.id),
  );

  await env.DB.prepare('DELETE FROM templates WHERE user_id = ?')
    .bind(userId)
    .run();
}

export async function purgeExpired(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id FROM messages
     WHERE mailbox IN ('spam', 'trash')
       AND updated_at < datetime('now', '-30 days')`,
  ).all<{ id: string }>();

  return purgeMessages(
    env,
    results.map(row => row.id),
  );
}

export async function getFolderCounts(
  env: Env,
  userId: string,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT mailbox, seen, COUNT(*) AS count
     FROM messages
     WHERE user_id = ? AND mailbox IN ('inbox', 'drafts', 'spam')
     GROUP BY mailbox, seen`,
  )
    .bind(userId)
    .all<{ mailbox: string; seen: number; count: number }>();

  let unread = 0;
  let drafts = 0;
  let spamUnread = 0;

  for (const row of results) {
    if (row.mailbox === 'drafts') {
      drafts += row.count;
    } else if (row.seen === 0) {
      if (row.mailbox === 'inbox') {
        unread += row.count;
      } else {
        spamUnread += row.count;
      }
    }
  }

  return Response.json({ unread, drafts, spam_unread: spamUnread });
}
