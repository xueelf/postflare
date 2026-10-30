import { Database } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';

import { storeMessage } from '#/worker/mail-store';

type Statement = { run: () => Promise<unknown> };

function d1(database: Database): D1Database {
  let batchChain = Promise.resolve();

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
    batch: (statements: Statement[]) => {
      const run = batchChain.then(async () => {
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
      });

      batchChain = run.then(
        () => undefined,
        () => undefined,
      );

      return run;
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

  db.run(`
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

  db.run(`
    CREATE UNIQUE INDEX idx_messages_message_id
      ON messages (user_id, direction, message_id)
      WHERE message_id IS NOT NULL
  `);

  return db;
}

function r2(options: { failPutOnCall?: number; failDelete?: boolean }): {
  bucket: R2Bucket;
  objects: Map<string, unknown>;
} {
  const objects = new Map<string, unknown>();

  let putCalls = 0;

  return {
    objects,
    bucket: {
      put: async (key: string, value: unknown) => {
        putCalls += 1;

        if (putCalls === options.failPutOnCall) {
          throw new Error('r2 put failed');
        }
        objects.set(key, value);
      },
      delete: async (keys: string | string[]) => {
        if (options.failDelete) {
          throw new Error('r2 delete failed');
        }

        for (const key of Array.isArray(keys) ? keys : [keys]) {
          objects.delete(key);
        }
      },
    } as unknown as R2Bucket,
  };
}

function parsed(messageId: string) {
  return {
    text: 'Hello',
    html: '<p>Hello</p>',
    attachments: [
      {
        filename: 'a.png',
        mimeType: 'image/png',
        disposition: 'attachment',
        contentId: null,
        content: new Uint8Array([1, 2, 3]).buffer,
      },
    ],
    messageId,
    inReplyTo: null,
    references: null,
  } as never;
}

function input(env: Env, messageId: string, mailbox: 'inbox' | 'sent') {
  return {
    env,
    userId: 'user-1',
    mailbox,
    direction:
      mailbox === 'inbox' ? ('inbound' as const) : ('outbound' as const),
    seen: 0,
    from: 'from@example.com',
    fromName: 'From',
    to: 'to@example.com',
    subject: 'Subject',
    parsed: parsed(messageId),
    raw: new TextEncoder().encode('raw').buffer as ArrayBuffer,
    createdAt: '2026-10-29 00:00:00',
  };
}

test('R2 写入失败不会留下可去重的邮件记录', async () => {
  const db = database();
  const { bucket, objects } = r2({ failPutOnCall: 2 });
  const env = { DB: d1(db), ATTACHMENTS: bucket } as Env;

  await expect(
    storeMessage(input(env, 'same@example.com', 'inbox')),
  ).rejects.toThrow('r2 put failed');

  expect(
    (
      db.query('SELECT count(*) AS count FROM messages').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);
  expect(objects.size).toBe(0);
});

test('R2 删除也失败后，存储恢复仍可重新导入同一封邮件', async () => {
  const db = database();
  const failing = r2({ failPutOnCall: 2, failDelete: true });
  const env = { DB: d1(db), ATTACHMENTS: failing.bucket } as Env;
  const error = spyOn(console, 'error').mockImplementation(() => {});

  try {
    await expect(
      storeMessage(input(env, 'retry@example.com', 'inbox')),
    ).rejects.toThrow('r2 put failed');
  } finally {
    error.mockRestore();
  }

  expect(
    (
      db.query('SELECT count(*) AS count FROM messages').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);

  const recovered = r2({});
  const id = await storeMessage(
    input(
      { DB: d1(db), ATTACHMENTS: recovered.bucket } as Env,
      'retry@example.com',
      'inbox',
    ),
  );

  expect(id).not.toBeNull();

  expect(
    (
      db.query('SELECT count(*) AS count FROM messages').get() as {
        count: number;
      }
    ).count,
  ).toBe(1);

  expect(
    (
      db.query('SELECT count(*) AS count FROM attachments').get() as {
        count: number;
      }
    ).count,
  ).toBe(1);
});

test('并发导入同一已发送邮件只保留一份', async () => {
  const db = database();
  const { bucket, objects } = r2({});
  const env = { DB: d1(db), ATTACHMENTS: bucket } as Env;
  const [first, second] = await Promise.all([
    storeMessage(input(env, 'duplicate@example.com', 'sent')),
    storeMessage(input(env, 'duplicate@example.com', 'sent')),
  ]);

  expect([first, second].filter(Boolean)).toHaveLength(1);
  expect([first, second].filter(value => value === null)).toHaveLength(1);

  expect(
    (
      db.query('SELECT count(*) AS count FROM messages').get() as {
        count: number;
      }
    ).count,
  ).toBe(1);

  expect(
    (
      db.query('SELECT count(*) AS count FROM attachments').get() as {
        count: number;
      }
    ).count,
  ).toBe(1);
  expect(objects.size).toBe(2);
});
