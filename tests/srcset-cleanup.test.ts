import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { updateTemplate } from '#/worker/templates';

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

  return { prepare } as unknown as D1Database;
}

function r2(): R2Bucket {
  return {
    delete: async () => {},
  } as unknown as R2Bucket;
}

test('srcset 引用的附件不会被模板 prune 删除', async () => {
  const database = new Database(':memory:');

  database.run(`
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      template_id TEXT,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_id TEXT,
      size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL
    )
  `);

  database.run(
    `INSERT INTO templates (id, user_id, name, subject, body_html, body_source, updated_at)
     VALUES ('template-1', 'user-1', 'T', '', '', '', '2026-10-29 00:00:00')`,
  );

  database.run(
    `INSERT INTO attachments (id, template_id, filename, content_type, content_id, size_bytes, storage_key)
     VALUES ('a1', 'template-1', 'image.png', 'image/png', NULL, 3, 'attachments/template-1/a1')`,
  );

  const env = { DB: d1(database), ATTACHMENTS: r2() } as Env;
  const source = '<img srcset="/api/attachments/a1 1x">';
  const response = await updateTemplate(
    env,
    'template-1',
    new Request('http://localhost/api/templates/template-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'T',
        subject: '',
        body_html: source,
        body_source: source,
        pruneIds: ['a1'],
      }),
    }),
    'user-1',
  );

  expect(response.status).toBe(200);

  const count = database
    .query('SELECT count(*) AS count FROM attachments WHERE id = ?')
    .get('a1') as { count: number };

  expect(count.count).toBe(1);
});
