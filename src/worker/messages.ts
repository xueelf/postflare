import type { AttachmentRow } from './attachments';
import { chunks, DB_PARAM_LIMIT, deleteObjects } from './batch';
import { badRequest, notFound, readJson } from './http';

const LIST_PAGE_SIZE = 30;
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
  row_id: number;
}

interface ListCursor {
  sort: string;
  rowId: number;
}

/** 游标由服务端生成、客户端原样回传，排序键与 rowid 一起定位下一页的起点。 */
export function formatListCursor(sort: string, rowId: number): string {
  return `${sort}|${rowId}`;
}

export function parseListCursor(value: string | null): ListCursor | null {
  if (!value) {
    return null;
  }
  const index = value.lastIndexOf('|');

  if (index <= 0) {
    return null;
  }
  const rowId = Number(value.slice(index + 1));

  if (!Number.isInteger(rowId)) {
    return null;
  }
  return { sort: value.slice(0, index), rowId };
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
  const order: 'created_at' | 'updated_at' =
    mailbox === 'drafts' ? 'updated_at' : 'created_at';
  const rawCursor = url.searchParams.get('cursor');
  const cursor = parseListCursor(rawCursor);

  if (rawCursor !== null && !cursor) {
    return badRequest('invalid cursor');
  }
  // 用 instr 做字面子串匹配，LIKE 的模式有 50 字节上限，且转义通配符后长度会翻倍
  const searchClause = query
    ? `AND (instr(lower(subject), lower(?)) > 0
            OR instr(lower(from_address), lower(?)) > 0
            OR instr(lower(to_address), lower(?)) > 0
            OR instr(lower(body_text), lower(?)) > 0)`
    : '';
  // 排序键相同的行用 rowid 继续排序，游标也要带上 rowid 才不会跳行或重复
  const cursorClause = cursor
    ? `AND (${order} < ? OR (${order} = ? AND rowid < ?))`
    : '';

  const statement = env.DB.prepare(
    `SELECT id, mailbox, direction, seen, from_address, from_name, to_address, subject,
            created_at, updated_at, rowid AS row_id
     FROM messages
     WHERE user_id = ? AND mailbox = ? ${searchClause} ${cursorClause}
     ORDER BY ${order} DESC, rowid DESC
     LIMIT ${LIST_PAGE_SIZE + 1}`,
  );
  const bound = statement.bind(
    userId,
    mailbox,
    ...(query ? [query, query, query, query] : []),
    ...(cursor ? [cursor.sort, cursor.sort, cursor.rowId] : []),
  );

  const { results } = await bound.all<MessageListRow>();
  const page = results.slice(0, LIST_PAGE_SIZE);
  const last = page[page.length - 1];
  const next =
    results.length > LIST_PAGE_SIZE && last
      ? formatListCursor(last[order], last.row_id)
      : null;

  return Response.json({
    messages: page.map(({ row_id: _rowId, ...message }) => message),
    next,
  });
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

interface DownloadRow {
  from_address: string;
  from_name: string;
  to_address: string;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  message_id: string | null;
  created_at: string;
  raw_storage_key: string | null;
}

const FILENAME_STRIP = /[\\/:*?"<>|]/g;
const CONTROL_CHARS = /\p{Cc}/gu;

/** 文件名用主题，去掉文件名不允许的字符，为空或过长时退回 id */
function emlFilename(subject: string, id: string): string {
  const cleaned = subject
    .replace(CONTROL_CHARS, ' ')
    .replace(FILENAME_STRIP, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();

  return `${cleaned || id}.eml`;
}

/** 非 ASCII 的头按 RFC 2047 编码，纯 ASCII 原样返回 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }

  const bytes = new TextEncoder().encode(value);

  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/** UTF-8 文本转 base64，按 MIME 要求每 76 字符折行 */
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);

  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/.{76}(?=.)/g, '$&\r\n');
}

/**
 * 发件没有存原文，用库里的头与正文拼一封 eml，内容与发出的一致。
 */
function buildEml(message: DownloadRow): string {
  const boundary = `postflare-${crypto.randomUUID()}`;
  const from = message.from_name
    ? `${encodeHeader(message.from_name)} <${message.from_address}>`
    : message.from_address;
  const domain = message.from_address.split('@')[1] ?? 'localhost';
  const date = new Date(`${message.created_at.replace(' ', 'T')}Z`);
  const lines = [
    `From: ${from}`,
    `To: ${message.to_address}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${message.message_id ?? `${crypto.randomUUID()}@${domain}`}>`,
    'MIME-Version: 1.0',
  ];

  if (message.body_html) {
    lines.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64(message.body_text ?? ''),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64(message.body_html),
      `--${boundary}--`,
    );
  } else {
    lines.push(
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64(message.body_text ?? ''),
    );
  }

  return lines.join('\r\n');
}

/**
 * 下载邮件：收到时存了原文就给原文，发件用拼出来的那封。
 */
export async function downloadMessage(
  env: Env,
  id: string,
  userId: string,
): Promise<Response> {
  const message = await env.DB.prepare(
    `SELECT from_address, from_name, to_address, subject,
            body_text, body_html, message_id, created_at, raw_storage_key
     FROM messages
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, userId)
    .first<DownloadRow>();

  if (!message) {
    return notFound();
  }

  const filename = emlFilename(message.subject, id);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const raw = message.raw_storage_key
    ? await env.ATTACHMENTS.get(message.raw_storage_key)
    : null;

  // 同 inbound，workers-types 与 DOM 库声明的 ReadableStream 类型不同，运行时一致
  return new Response(
    raw ? (raw.body as unknown as BodyInit) : buildEml(message),
    {
      headers: {
        'Content-Type': 'message/rfc822',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    },
  );
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
