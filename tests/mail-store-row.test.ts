import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { D1_MAX_ROW_BYTES } from '#/limits';
import { storeMessage } from '#/worker/mail-store';

// 只实现 storeMessage 用到的 D1 接口，数据库留在内存里
function d1(database: Database): D1Database {
  const prepare = (sql: string) => {
    const bind = (...params: unknown[]) => ({
      first: async <T>() =>
        (database.query(sql).get(...(params as never[])) as T) ?? null,
      all: async <T>() => ({
        results: database.query(sql).all(...(params as never[])) as T[],
      }),
      run: async () => {
        const result = database.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    });

    return { bind };
  };

  return {
    prepare,
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      database.run('BEGIN');

      try {
        for (const statement of statements) {
          await statement.run();
        }
        database.run('COMMIT');
      } catch (error) {
        database.run('ROLLBACK');

        throw error;
      }
    },
  } as unknown as D1Database;
}

function r2(): R2Bucket {
  const objects = new Map<string, unknown>();

  return {
    put: async (key: string, value: unknown) => {
      objects.set(key, value);
    },
    delete: async (key: string) => {
      objects.delete(key);
    },
  } as unknown as R2Bucket;
}

test('storeMessage 的实际记录不超过 D1 上限', async () => {
  const database = new Database(':memory:');

  database.run(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mailbox TEXT NOT NULL DEFAULT 'inbox',
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

  const html = `<p>${'a'.repeat(2_100_000)}</p>`;
  const id = await storeMessage({
    env: { DB: d1(database), ATTACHMENTS: r2() } as Env,
    userId: 'user-id',
    mailbox: 'inbox',
    direction: 'inbound',
    seen: 0,
    from: 'from@example.com',
    fromName: 'From',
    to: 'to@example.com',
    subject: 'Subject',
    parsed: {
      text: null,
      html,
      attachments: [],
      messageId: 'message@example.com',
      inReplyTo: null,
      references: null,
    } as never,
    raw: new ArrayBuffer(0),
    createdAt: '2026-10-29 00:00:00',
  });

  expect(id).not.toBeNull();

  const payload = database
    .query("SELECT sum(payload) AS payload FROM dbstat WHERE name = 'messages'")
    .get() as { payload: number };

  expect(payload.payload).toBeLessThanOrEqual(D1_MAX_ROW_BYTES);

  const row = database
    .query('SELECT body_html FROM messages WHERE id = ?')
    .get(id as string) as { body_html: string };

  expect(row.body_html.length).toBeLessThan(html.length);
});
