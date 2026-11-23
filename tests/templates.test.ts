import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { MAX_TEMPLATE_BYTES } from '#/limits';
import {
  createTemplate,
  createTemplatePayload,
  parseTemplatePayload,
  templateRowTooLarge,
} from '#/worker/templates';

test('模板保留用户写入的 base64 data URL，不做解码或替换', () => {
  const source =
    '<image src="data:image/png;base64,not-valid-base64" alt=""></image>';
  const payload = createTemplatePayload(
    '测试',
    '主题',
    `<p>${source}</p>`,
    source,
  );

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(payload.body_html).toContain(
      'data:image/png;base64,not-valid-base64',
    );
    expect(payload.body_source).toBe(source);
  }
});

test('模板允许用户清空正文和源码', () => {
  const payload = createTemplatePayload('空模板', '', '', '');

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(payload.body_html).toBe('');
    expect(payload.body_source).toBe('');
  }
});

test('模板字段类型错误返回 400，不解释成清空', () => {
  const wrongSubject = parseTemplatePayload({
    name: '模板',
    subject: 1,
    body_html: '',
    body_source: '',
  });
  const wrongBody = parseTemplatePayload({
    name: '模板',
    subject: '',
    body_html: null,
    body_source: '',
  });

  expect(wrongSubject instanceof Response).toBe(true);
  expect(wrongBody instanceof Response).toBe(true);

  if (wrongSubject instanceof Response) {
    expect(wrongSubject.status).toBe(400);
  }

  if (wrongBody instanceof Response) {
    expect(wrongBody.status).toBe(400);
  }
});

test('模板允许合法空字符串字段', () => {
  const payload = parseTemplatePayload({
    name: '空模板',
    subject: '',
    body_html: '',
    body_source: '',
  });

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(payload.subject).toBe('');
    expect(payload.body_html).toBe('');
    expect(payload.body_source).toBe('');
  }
});

test('模板超过 D1 单行上限时拒绝保存', () => {
  const payload = createTemplatePayload(
    '大模板',
    '主题',
    `<p>${'a'.repeat(MAX_TEMPLATE_BYTES)}</p>`,
    '<p>正文</p>',
  );

  expect(payload instanceof Response).toBe(false);

  if (!(payload instanceof Response)) {
    expect(templateRowTooLarge('template-id', 'user-id', payload)).toBe(true);
  }
});

test('另存模板在 R2 复制期间不可见，中途失败不留半成品与孤儿对象', async () => {
  const db = new Database(':memory:');

  db.run(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_source TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      template_id TEXT,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_key TEXT NOT NULL
    )
  `);

  db.run("INSERT INTO messages (id, user_id) VALUES ('msg-1', 'user-1')");

  db.run(
    `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, storage_key)
     VALUES ('a1', 'msg-1', 'one.png', 'image/png', 3, 'attachments/msg-1/a1'),
            ('a2', 'msg-1', 'two.png', 'image/png', 3, 'attachments/msg-1/a2')`,
  );

  const objects = new Map<string, Uint8Array>([
    ['attachments/msg-1/a1', new Uint8Array([1, 2, 3])],
    ['attachments/msg-1/a2', new Uint8Array([4, 5, 6])],
  ]);

  let putCount = 0;
  let visibleDuringCopy = -1;
  let failOnSecondPut = true;

  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async <T>() =>
        (db.query(sql).get(...(params as never[])) as T) ?? null,
      all: async <T>() => ({
        results: db.query(sql).all(...(params as never[])) as T[],
      }),
      run: async () => {
        const result = db.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    }),
  });

  const env = {
    DB: {
      prepare,
      batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
        db.run('BEGIN');

        try {
          for (const statement of statements) {
            await statement.run();
          }
          db.run('COMMIT');
        } catch (error) {
          db.run('ROLLBACK');

          throw error;
        }
      },
    } as unknown as D1Database,
    ATTACHMENTS: {
      get: async (key: string) => {
        const data = objects.get(key);

        return data ? { body: data.buffer, size: data.byteLength } : null;
      },
      put: async (key: string, body: ArrayBuffer) => {
        putCount += 1;

        if (putCount === 1) {
          visibleDuringCopy = (
            db.query('SELECT count(*) AS count FROM templates').get() as {
              count: number;
            }
          ).count;
        }

        if (failOnSecondPut && putCount === 2) {
          throw new Error('r2 copy failed');
        }
        objects.set(key, new Uint8Array(body));
      },
      delete: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          objects.delete(key);
        }
      },
    } as unknown as R2Bucket,
  } as Env;

  const body = JSON.stringify({
    name: 'T1',
    subject: 'S1',
    body_html:
      '<p><img src="/api/attachments/a1"><img src="/api/attachments/a2"></p>',
    body_source:
      '<image src="/api/attachments/a1"></image>\n<image src="/api/attachments/a2"></image>\n',
  });

  await expect(
    createTemplate(
      env,
      new Request('http://localhost/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      'user-1',
    ),
  ).rejects.toThrow('r2 copy failed');

  expect(visibleDuringCopy).toBe(0);

  expect(
    (
      db.query('SELECT count(*) AS count FROM templates').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);
  expect(objects.size).toBe(2);

  failOnSecondPut = false;
  putCount = 0;

  const response = await createTemplate(
    env,
    new Request('http://localhost/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
    'user-1',
  );

  expect(response.status).toBe(201);
  expect(visibleDuringCopy).toBe(0);

  const created = db
    .query('SELECT id, body_html, body_source FROM templates')
    .get() as { id: string; body_html: string; body_source: string };

  expect(created.body_source.endsWith('\n')).toBe(true);
  expect(created.body_html).not.toContain('/api/attachments/a1');
  expect(created.body_source).not.toContain('/api/attachments/a1');
});
