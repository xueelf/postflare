import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import PostalMime from 'postal-mime';

import { storeMessage } from '#/worker/mail-store';
import { messageDetail } from '#/worker/messages';
import { buildRawMessage } from '#/worker/mime';

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

function r2(): { bucket: R2Bucket; objects: Map<string, unknown> } {
  const objects = new Map<string, unknown>();
  const bucket = {
    put: async (key: string, value: unknown) => {
      objects.set(key, value);
    },
    delete: async (key: string | string[]) => {
      for (const item of Array.isArray(key) ? key : [key]) {
        objects.delete(item);
      }
    },
  } as unknown as R2Bucket;

  return { bucket, objects };
}

function databaseWithSchema(): Database {
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

test('CID 实体引号在完整 MIME 往返后仍能还原', async () => {
  const database = databaseWithSchema();
  const { bucket, objects } = r2();
  const html =
    '<p>Hello</p><div style="background-image:url(&quot;cid:inline-1&quot;)"></div>';
  const raw = buildRawMessage({
    from: 'sender@example.com',
    fromName: 'Sender',
    to: 'me@example.com',
    subject: 'CID',
    text: 'Hello',
    html,
    attachments: [
      {
        filename: 'image.png',
        type: 'image/png',
        content: new Uint8Array([1, 2, 3]).buffer,
        disposition: 'inline',
        contentId: 'inline-1',
      },
    ],
  });
  const parsed = await PostalMime.parse(raw);

  expect(parsed.html).toContain('&quot;cid:inline-1&quot;');

  const env = { DB: d1(database), ATTACHMENTS: bucket } as Env;
  const id = await storeMessage({
    env,
    userId: 'user-1',
    mailbox: 'inbox',
    direction: 'inbound',
    seen: 0,
    from: 'sender@example.com',
    fromName: 'Sender',
    to: 'me@example.com',
    subject: 'CID',
    parsed: parsed as never,
    raw: new TextEncoder().encode(raw).buffer as ArrayBuffer,
    createdAt: '2026-10-29 00:00:00',
  });

  expect(id).not.toBeNull();

  const attachment = database
    .query(
      'SELECT id, filename, content_id FROM attachments WHERE message_id = ?',
    )
    .get(id as string) as {
    id: string;
    filename: string;
    content_id: string;
  };

  expect(attachment.filename).toBe('image.png');
  expect(attachment.content_id).toBe('inline-1');
  expect(objects.has(`raw/${id as string}.eml`)).toBe(true);

  expect(objects.has(`attachments/${id as string}/${attachment.id}`)).toBe(
    true,
  );

  const detail = await messageDetail(env, id as string, 'user-1');

  expect(detail).not.toBeNull();
  expect(detail?.body_html).toContain(`/api/attachments/${attachment.id}`);
  expect(detail?.body_html).not.toContain('cid:inline-1');
  expect(detail?.attachments).toHaveLength(0);
});
