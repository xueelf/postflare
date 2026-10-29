import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { composeMessage } from '#/worker/compose';

type Statement = {
  run: () => Promise<unknown>;
};

function d1(database: Database): D1Database {
  const prepare = (sql: string) => {
    const bind = (...params: unknown[]) => {
      const statement: Statement = {
        run: async () => {
          database.query(sql).run(...(params as never[]));
        },
      };

      return statement;
    };

    return { bind };
  };

  return {
    prepare,
    batch: async (statements: Statement[]) => {
      for (const statement of statements) {
        await statement.run();
      }
    },
  } as unknown as D1Database;
}

function r2(): { bucket: R2Bucket; objects: Map<string, unknown> } {
  const objects = new Map<string, unknown>();

  const bucket = {
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
      seen INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      from_name TEXT NOT NULL,
      to_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT,
      body_html TEXT,
      body_source TEXT,
      message_id TEXT,
      in_reply_to TEXT,
      "references" TEXT,
      raw_storage_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
