import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';

import {
  emptyMailbox,
  listMessages,
  purgeExpired,
  purgeMessage,
  updateMessage,
} from '#/worker/messages';

function d1(database: Database): D1Database {
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async <T>() =>
        (database.query(sql).get(...(params as never[])) as T) ?? null,
      all: async <T>() => ({
        results: database.query(sql).all(...(params as never[])) as T[],
      }),
      run: async () => {
        const result = database.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    }),
  });

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

function database(): Database {
  const db = new Database(':memory:');

  db.run(`
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
      raw_storage_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      storage_key TEXT NOT NULL
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

test('永久删除接口拒绝直接删除收件箱或已发送邮件', async () => {
  const db = database();

  db.run(
    `INSERT INTO messages (id, user_id, mailbox, direction, updated_at)
     VALUES ('inbox-1', 'user-1', 'inbox', 'inbound', datetime('now'))`,
  );

  const response = await purgeMessage(
    {
      DB: d1(db),
      ATTACHMENTS: { delete: async () => {} } as unknown as R2Bucket,
    } as Env,
    'inbox-1',
    'user-1',
  );

  expect(response.status).toBe(400);

  expect(
    (
      db.query('SELECT count(*) AS count FROM messages').get() as {
        count: number;
      }
    ).count,
  ).toBe(1);
});

test('清空回收站暂停在 R2 删除期间时，并发恢复被拒绝，不会出现恢复成功但邮件消失', async () => {
  const db = database();

  db.run(
    `INSERT INTO messages (id, user_id, mailbox, direction, updated_at)
     VALUES ('message-1', 'user-1', 'trash', 'inbound', datetime('now'))`,
  );

  let releaseDelete!: () => void;
  let notifyDeleteStarted!: () => void;

  const deleteStarted = new Promise<void>(resolve => {
    notifyDeleteStarted = resolve;
  });
  const deletePaused = new Promise<void>(resolve => {
    releaseDelete = resolve;
  });

  const env = {
    DB: d1(db),
    ATTACHMENTS: {
      delete: async () => {
        notifyDeleteStarted();
        await deletePaused;
      },
    } as unknown as R2Bucket,
  } as Env;

  const emptyPromise = emptyMailbox(
    env,
    new URL('http://localhost/api/messages?mailbox=trash'),
    'user-1',
  );

  await deleteStarted;

  const restoreResponse = await updateMessage(
    env,
    'message-1',
    'user-1',
    request('inbox'),
  );

  expect(restoreResponse.status).toBe(410);

  releaseDelete();

  const emptyResponse = await emptyPromise;

  expect(emptyResponse.status).toBe(200);

  expect(
    (
      db.query('SELECT count(*) AS count FROM messages').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);
});

test('永久删除遇到 R2 瞬时失败时邮件立即不可见，并由下一次 purgeExpired 完成清理', async () => {
  const db = database();

  db.run(
    `INSERT INTO messages (id, user_id, mailbox, direction, updated_at)
     VALUES ('message-1', 'user-1', 'trash', 'inbound', datetime('now'))`,
  );

  let failR2 = true;

  const env = {
    DB: d1(db),
    ATTACHMENTS: {
      delete: async () => {
        if (failR2) {
          throw new Error('r2 delete failed');
        }
      },
    } as unknown as R2Bucket,
  } as Env;

  const error = spyOn(console, 'error').mockImplementation(() => {});

  let response: Response;

  try {
    response = await purgeMessage(env, 'message-1', 'user-1');
  } finally {
    error.mockRestore();
  }

  expect(response.status).toBe(200);

  const listResponse = await listMessages(
    env,
    new URL('http://localhost/api/messages?mailbox=trash'),
    'user-1',
  );
  const listData = (await listResponse.json()) as {
    messages: Array<{ id: string }>;
  };

  expect(listData.messages).toHaveLength(0);

  failR2 = false;

  const cleaned = await purgeExpired(env);

  expect(cleaned).toBe(1);

  expect(
    (
      db.query('SELECT count(*) AS count FROM messages').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);
});
