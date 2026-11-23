import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { composeMessage, saveDraft } from '#/worker/compose';

type Statement = {
  run: () => Promise<unknown>;
};

function d1(database: Database): D1Database {
  const prepare = (sql: string) => {
    const bind = (...params: unknown[]) => {
      const statement: Statement & {
        first: <T>() => Promise<T | null>;
        all: <T>() => Promise<{ results: T[] }>;
      } = {
        first: async <T>() =>
          (database.query(sql).get(...(params as never[])) as T) ?? null,
        all: async <T>() => ({
          results: database.query(sql).all(...(params as never[])) as T[],
        }),
        run: async () => {
          const result = database.query(sql).run(...(params as never[]));

          return { meta: { changes: result.changes } };
        },
      };

      return statement;
    };

    return { bind };
  };

  return {
    prepare,
    batch: async (statements: Statement[]) => {
      database.run('BEGIN');

      try {
        const results = [];

        for (const statement of statements) {
          results.push(await statement.run());
        }
        database.run('COMMIT');

        return results;
      } catch (error) {
        database.run('ROLLBACK');

        throw error;
      }
    },
  } as unknown as D1Database;
}

function r2(): { bucket: R2Bucket; objects: Map<string, unknown> } {
  const objects = new Map<string, unknown>();

  const bucket = {
    get: async (key: string) => {
      const value = objects.get(key);

      if (!value) {
        return null;
      }
      const bytes =
        value instanceof Uint8Array
          ? value
          : new TextEncoder().encode(String(value));

      return {
        body: bytes.buffer,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer,
        text: async () => new TextDecoder().decode(bytes),
      };
    },
    put: async (key: string, value: unknown) => {
      objects.set(key, value);
    },
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        objects.delete(key);
      }
    },
  } as unknown as R2Bucket;

  return { bucket, objects };
}

function messagesDatabase(): Database {
  const database = new Database(':memory:');

  database.run(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mailbox TEXT NOT NULL,
      direction TEXT NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0,
      from_address TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT '',
      to_address TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body_text TEXT,
      body_html TEXT,
      body_source TEXT,
      message_id TEXT,
      in_reply_to TEXT,
      "references" TEXT,
      raw_storage_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.run(`
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_source TEXT NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      template_id TEXT,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_id TEXT,
      size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL
    )
  `);

  return database;
}

test('发件归档先外置源码，再判断是否截断展示正文', async () => {
  const database = messagesDatabase();
  const { bucket, objects } = r2();
  const source = `<style>${'x'.repeat(2_100_000)}</style>`;
  const text = 'Short body';
  const html = '<p>Short body</p>';
  const response = await composeMessage(
    {
      DB: d1(database),
      ATTACHMENTS: bucket,
      EMAIL: {
        send: async () => ({ messageId: 'sent@example.com' }),
      },
    } as unknown as Env,
    {
      id: 'user-id',
      email: 'me@example.com',
      name: 'Me',
      language: 'en',
      role: 'user',
    },
    new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'you@example.com',
        subject: 'Subject',
        text,
        html,
        source,
      }),
    }),
  );
  const result = (await response.json()) as { id: string; archived: boolean };
  const row = database
    .query(
      'SELECT body_text, body_html, body_source, raw_storage_key FROM messages WHERE id = ?',
    )
    .get(result.id) as {
    body_text: string;
    body_html: string;
    body_source: string | null;
    raw_storage_key: string;
  };

  expect(result.archived).toBe(true);
  expect(row.body_text).toBe(text);
  expect(row.body_html).toBe(html);
  expect(row.body_source).toBeNull();
  expect(objects.has(`source/${result.id}.inky`)).toBe(true);
  expect(objects.get(`source/${result.id}.inky`)).toBe(source);
  expect(row.raw_storage_key).toBe(`raw/${result.id}.eml`);
});

test('发信不受 D1 行预算预检阻断，归档阶段再处理存储限制', async () => {
  const database = messagesDatabase();
  const { bucket } = r2();

  let sent = false;

  const text = 'A'.repeat(1_010_000);
  const html = `<p>${'A'.repeat(1_017_000)}</p>`;
  const response = await composeMessage(
    {
      DB: d1(database),
      ATTACHMENTS: bucket,
      EMAIL: {
        send: async () => {
          sent = true;

          return { messageId: 'large@example.com' };
        },
      },
    } as unknown as Env,
    {
      id: 'user-id',
      email: 'me@example.com',
      name: 'Me',
      language: 'en',
      role: 'user',
    },
    new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'you@example.com',
        subject: 'Large but valid',
        text,
        html,
        source: '<p>Large but valid</p>',
      }),
    }),
  );

  expect(response.status).toBe(201);
  expect(sent).toBe(true);
});

test('同一草稿并发或重放发送只调用一次发信绑定', async () => {
  const database = messagesDatabase();
  const { bucket } = r2();

  database.run(
    `INSERT INTO messages (id, user_id, mailbox, direction, subject, body_text, body_html, body_source)
     VALUES ('draft-1', 'user-id', 'drafts', 'outbound', 'S', 'Hi', '<p>Hi</p>', '<p>Hi</p>')`,
  );

  let sendCalls = 0;

  const env = {
    DB: d1(database),
    ATTACHMENTS: bucket,
    EMAIL: {
      send: async () => {
        sendCalls += 1;

        return { messageId: 'once@example.com' };
      },
    },
  } as unknown as Env;
  const user = {
    id: 'user-id',
    email: 'me@example.com',
    name: 'Me',
    language: 'en',
    role: 'user' as const,
  };
  const makeRequest = () =>
    new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'you@example.com',
        subject: 'S',
        text: 'Hi',
        html: '<p>Hi</p>',
        source: '<p>Hi</p>',
        draftId: 'draft-1',
      }),
    });

  const [first, second] = await Promise.all([
    composeMessage(env, user, makeRequest()),
    composeMessage(env, user, makeRequest()),
  ]);

  expect(sendCalls).toBe(1);
  expect([first.status, second.status].sort()).toEqual([201, 404]);
});

test('模板转草稿原子发布并派生可搜索的纯文本正文', async () => {
  const database = messagesDatabase();
  const { bucket, objects } = r2();

  database.run(
    `INSERT INTO templates (id, user_id, name, subject, body_html, body_source)
     VALUES ('tpl-1', 'user-id', 'T', '欢迎', '<style>.a{color:red}</style><p>欢迎来到 pixiv 服务</p><img src="/api/attachments/tpl-att">', '<image src="/api/attachments/tpl-att"></image>')`,
  );

  database.run(
    `INSERT INTO attachments (id, template_id, filename, content_type, size_bytes, storage_key)
     VALUES ('tpl-att', 'tpl-1', 'hero.png', 'image/png', 3, 'attachments/tpl-1/tpl-att')`,
  );
  objects.set('attachments/tpl-1/tpl-att', new Uint8Array([1, 2, 3]));

  const response = await saveDraft(
    {
      DB: d1(database),
      ATTACHMENTS: bucket,
    } as unknown as Env,
    {
      id: 'user-id',
      email: 'me@example.com',
      name: 'Me',
      language: 'en',
      role: 'user',
    },
    new Request('http://localhost/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'tpl-1' }),
    }),
  );

  expect(response.status).toBe(201);

  const { id } = (await response.json()) as { id: string };
  const row = database
    .query(
      'SELECT body_text, body_html, body_source FROM messages WHERE id = ?',
    )
    .get(id) as { body_text: string; body_html: string; body_source: string };

  expect(row.body_text).toBe('欢迎来到 pixiv 服务');
  expect(row.body_html).not.toContain('/api/attachments/tpl-att');
  expect(row.body_source).not.toContain('/api/attachments/tpl-att');
});
