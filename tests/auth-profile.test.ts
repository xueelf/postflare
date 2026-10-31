import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { handleAuth } from '#/worker/auth';

const SNAPSHOT = {
  id: 'user-1',
  email: 'me@example.com',
  name: 'Old',
  language: 'en',
  role: 'user' as const,
};

function d1(database: Database): D1Database {
  const prepare = (sql: string) => {
    const bind = (...params: unknown[]) => ({
      first: async <T>() => {
        if (sql.includes('FROM sessions s JOIN users')) {
          return SNAPSHOT as T;
        }

        if (sql.includes('FROM users WHERE id = ?')) {
          return (database.query(sql).get(...(params as never[])) as T) ?? null;
        }

        throw new Error(`unexpected first query: ${sql}`);
      },
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

function request(body: Record<string, string>): Request {
  return new Request('http://localhost/api/auth/profile', {
    method: 'POST',
    headers: {
      Cookie: 'session=token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('资料部分更新只写提交字段，并发请求不互相回滚', async () => {
  const database = new Database(':memory:');

  database.run(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      language TEXT,
      role TEXT
    )
  `);

  database.run(
    'INSERT INTO users (id, email, name, language, role) VALUES (?, ?, ?, ?, ?)',
    [
      SNAPSHOT.id,
      SNAPSHOT.email,
      SNAPSHOT.name,
      SNAPSHOT.language,
      SNAPSHOT.role,
    ],
  );

  const env = { DB: d1(database) } as Env;

  const [nameResponse, languageResponse] = await Promise.all([
    handleAuth(env, '/api/auth/profile', request({ name: 'New Name' })),
    handleAuth(env, '/api/auth/profile', request({ language: 'de' })),
  ]);

  expect(nameResponse.status).toBe(200);
  expect(languageResponse.status).toBe(200);

  const row = database
    .query('SELECT name, language FROM users WHERE id = ?')
    .get(SNAPSHOT.id) as { name: string; language: string };

  expect(row).toEqual({ name: 'New Name', language: 'de' });
});
