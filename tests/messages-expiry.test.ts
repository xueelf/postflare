import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { updateMessage } from '#/worker/messages';

function d1(database: Database): D1Database {
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async <T>() =>
        (database.query(sql).get(...(params as never[])) as T) ?? null,
      run: async () => {
        const result = database.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    }),
  });

  return { prepare } as unknown as D1Database;
}

function database(): Database {
  const db = new Database(':memory:');

  db.run(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mailbox TEXT NOT NULL,
      direction TEXT NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);

  return db;
}

function request(mailbox: string): Request {
  return new Request('http://localhost/api/messages/message-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mailbox }),
  });
}

test('满 30 天的回收站邮件不能恢复到收件箱', async () => {
  const db = database();

  db.run(
    `INSERT INTO messages (id, user_id, mailbox, direction, updated_at)
     VALUES ('message-1', 'user-1', 'trash', 'inbound', datetime('now', '-31 days'))`,
  );

  const response = await updateMessage(
    { DB: d1(db) } as Env,
    'message-1',
    'user-1',
    request('inbox'),
  );

  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({ error: 'message expired' });

  expect(
    (
      db
        .query('SELECT mailbox FROM messages WHERE id = ?')
        .get('message-1') as {
        mailbox: string;
      }
    ).mailbox,
  ).toBe('trash');
});

test('未满 30 天的回收站邮件仍可恢复', async () => {
  const db = database();

  db.run(
    `INSERT INTO messages (id, user_id, mailbox, direction, updated_at)
     VALUES ('message-1', 'user-1', 'trash', 'inbound', datetime('now', '-29 days'))`,
  );

  const response = await updateMessage(
    { DB: d1(db) } as Env,
    'message-1',
    'user-1',
    request('inbox'),
  );

  expect(response.status).toBe(200);

  expect(
    (
      db
        .query('SELECT mailbox FROM messages WHERE id = ?')
        .get('message-1') as {
        mailbox: string;
      }
    ).mailbox,
  ).toBe('inbox');
});

test('过期的垃圾邮件不能通过转入回收站延长保留期', async () => {
  const db = database();

  db.run(
    `INSERT INTO messages (id, user_id, mailbox, direction, updated_at)
     VALUES ('message-1', 'user-1', 'spam', 'inbound', datetime('now', '-31 days'))`,
  );

  const response = await updateMessage(
    { DB: d1(db) } as Env,
    'message-1',
    'user-1',
    request('trash'),
  );

  expect(response.status).toBe(410);
});
