import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import {
  createSession,
  handleAuth,
  hashPassword,
  sha256Hex,
} from '#/worker/auth';
import { handleInvite } from '#/worker/users';

function d1(database: Database): D1Database {
  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
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
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      password_hash TEXT
    )
  `);

  db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    )
  `);

  return db;
}

test('登录会话只在用户仍启用且密码哈希未变时创建', async () => {
  const db = database();

  db.run(
    "INSERT INTO users (id, status, password_hash) VALUES ('user-1', 'active', 'hash-a')",
  );

  const env = { DB: d1(db) } as Env;

  expect(await createSession(env, 'user-1', 'hash-a')).not.toBeNull();

  const count = () =>
    (
      db.query('SELECT count(*) AS count FROM sessions').get() as {
        count: number;
      }
    ).count;

  expect(count()).toBe(1);
  expect(await createSession(env, 'user-1', 'hash-b')).toBeNull();
  expect(count()).toBe(1);

  db.run("UPDATE users SET status = 'disabled' WHERE id = 'user-1'");

  expect(await createSession(env, 'user-1', 'hash-a')).toBeNull();
  expect(count()).toBe(1);
});

test('密码在验证后重置时，旧密码登录不创建会话', async () => {
  const db = new Database(':memory:');

  db.run(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      password_hash TEXT,
      failed_login_at TEXT,
      failed_login_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    )
  `);

  const oldHash = await hashPassword('old password');
  const newHash = await hashPassword('new password');

  db.run(
    `INSERT INTO users
       (id, email, name, language, role, status, password_hash)
     VALUES ('user-1', 'alice@example.com', 'Alice', 'en', 'user', 'active', ?)`,
    [oldHash],
  );

  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async <T>() =>
        (db.query(sql).get(...(params as never[])) as T) ?? null,
      run: async () => {
        // 模拟密码在 verifyPassword 之后、会话插入之前被重置
        if (sql.includes('INSERT INTO sessions')) {
          db.run('UPDATE users SET password_hash = ? WHERE id = ?', [
            newHash,
            'user-1',
          ]);
        }
        const result = db.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    }),
  });
  const env = {
    DB: { prepare } as unknown as D1Database,
    MAIL_DOMAIN: 'example.com',
  } as Env;
  const response = await handleAuth(
    env,
    '/api/auth/login',
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'old password' }),
    }),
  );

  expect(response.status).toBe(401);
  expect(response.headers.get('Set-Cookie')).toBeNull();

  expect(
    (
      db.query('SELECT count(*) AS count FROM sessions').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);
});

test('密码重置自动登录复用条件会话签发', async () => {
  const db = new Database(':memory:');

  db.run(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      password_hash TEXT
    )
  `);

  db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE user_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT,
      max_uses INTEGER NOT NULL,
      used_count INTEGER NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  db.run(
    `INSERT INTO users
       (id, email, name, language, role, status, password_hash)
     VALUES ('user-1', 'alice@example.com', 'Alice', 'en', 'user', 'active', 'hash-a')`,
  );

  const token = 'reset-token';
  const tokenHash = await sha256Hex(token);

  db.run(
    `INSERT INTO user_tokens (token_hash, user_id, max_uses, used_count, expires_at)
     VALUES (?, 'user-1', 1, 0, ?)`,
    [tokenHash, new Date(Date.now() + 60_000).toISOString()],
  );

  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async <T>() =>
        (db.query(sql).get(...(params as never[])) as T) ?? null,
      run: async () => {
        // 模拟另一个重置在当前会话插入前完成
        if (sql.includes('INSERT INTO sessions')) {
          db.run(
            "UPDATE users SET password_hash = 'hash-b' WHERE id = 'user-1'",
          );
        }
        const result = db.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    }),
  });
  const batch = async (statements: Array<{ run: () => Promise<unknown> }>) => {
    db.run('BEGIN');

    try {
      const results = [];

      for (const statement of statements) {
        results.push(await statement.run());
      }
      db.run('COMMIT');

      return results;
    } catch (error) {
      db.run('ROLLBACK');

      throw error;
    }
  };
  const env = {
    DB: { prepare, batch } as unknown as D1Database,
    MAIL_DOMAIN: 'example.com',
  } as Env;
  const response = await handleInvite(
    env,
    `/api/invite/${token}`,
    new Request(`http://localhost/api/invite/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'new password' }),
    }),
  );

  expect(response.status).toBe(410);
  expect(response.headers.get('Set-Cookie')).toBeNull();

  expect(
    (
      db.query('SELECT count(*) AS count FROM sessions').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);

  expect(
    (
      db.query("SELECT password_hash FROM users WHERE id = 'user-1'").get() as {
        password_hash: string;
      }
    ).password_hash,
  ).toBe('hash-b');
});

test('旧改密请求不能覆盖随后完成的密码重置', async () => {
  const db = new Database(':memory:');

  db.run(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      password_hash TEXT
    )
  `);

  db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    )
  `);

  const oldHash = await hashPassword('old password');
  const resetHash = await hashPassword('reset password');
  const tokenHashA = await sha256Hex('token-a');
  const tokenHashB = await sha256Hex('token-b');
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  db.run(
    `INSERT INTO users
       (id, email, name, language, role, status, password_hash)
     VALUES ('user-1', 'alice@example.com', 'Alice', 'en', 'user', 'active', ?)`,
    [oldHash],
  );

  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ('session-a', 'user-1', ?, ?)`,
    [tokenHashA, expiresAt],
  );

  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async <T>() =>
        (db.query(sql).get(...(params as never[])) as T) ?? null,
      run: async () => {
        const result = db.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    }),
  });
  const batch = async (statements: Array<{ run: () => Promise<unknown> }>) => {
    // 旧改密 batch 执行前，密码重置 B 已完成改密、撤销会话和新建会话
    db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHashA]);

    db.run("UPDATE users SET password_hash = ? WHERE id = 'user-1'", [
      resetHash,
    ]);

    db.run(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('session-b', 'user-1', ?, ?)`,
      [tokenHashB, expiresAt],
    );

    db.run('BEGIN');

    try {
      const results = [];

      for (const statement of statements) {
        results.push(await statement.run());
      }
      db.run('COMMIT');

      return results;
    } catch (error) {
      db.run('ROLLBACK');

      throw error;
    }
  };
  const env = {
    DB: { prepare, batch } as unknown as D1Database,
    MAIL_DOMAIN: 'example.com',
  } as Env;
  const response = await handleAuth(
    env,
    '/api/auth/password',
    new Request('http://localhost/api/auth/password', {
      method: 'POST',
      headers: {
        Cookie: 'session=token-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        current: 'old password',
        next: 'new password',
      }),
    }),
  );

  expect(response.status).toBe(400);

  expect(await response.json()).toEqual({
    error: 'current password is incorrect',
  });

  expect(
    (
      db.query("SELECT password_hash FROM users WHERE id = 'user-1'").get() as {
        password_hash: string;
      }
    ).password_hash,
  ).toBe(resetHash);

  const sessions = db
    .query('SELECT token_hash FROM sessions ORDER BY id')
    .all() as Array<{ token_hash: string }>;

  expect(sessions).toEqual([{ token_hash: tokenHashB }]);
});

async function changePasswordRequest(
  beforeBatch?: (
    db: Database,
    tokenHashA: string,
    tokenHashB: string,
    expiresAt: string,
  ) => void,
) {
  const db = new Database(':memory:');

  db.run(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      language TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      password_hash TEXT
    )
  `);

  db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    )
  `);

  const oldHash = await hashPassword('old password');
  const tokenHashA = await sha256Hex('token-a');
  const tokenHashB = await sha256Hex('token-b');
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  db.run(
    `INSERT INTO users
       (id, email, name, language, role, status, password_hash)
     VALUES ('user-1', 'alice@example.com', 'Alice', 'en', 'user', 'active', ?)`,
    [oldHash],
  );

  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ('session-a', 'user-1', ?, ?)`,
    [tokenHashA, expiresAt],
  );

  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ('session-b', 'user-1', ?, ?)`,
    [tokenHashB, expiresAt],
  );

  const prepare = (sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async <T>() =>
        (db.query(sql).get(...(params as never[])) as T) ?? null,
      run: async () => {
        const result = db.query(sql).run(...(params as never[]));

        return { meta: { changes: result.changes } };
      },
    }),
  });
  const batch = async (statements: Array<{ run: () => Promise<unknown> }>) => {
    beforeBatch?.(db, tokenHashA, tokenHashB, expiresAt);

    db.run('BEGIN');

    try {
      const results = [];

      for (const statement of statements) {
        results.push(await statement.run());
      }
      db.run('COMMIT');

      return results;
    } catch (error) {
      db.run('ROLLBACK');

      throw error;
    }
  };
  const env = {
    DB: { prepare, batch } as unknown as D1Database,
    MAIL_DOMAIN: 'example.com',
  } as Env;
  const response = await handleAuth(
    env,
    '/api/auth/password',
    new Request('http://localhost/api/auth/password', {
      method: 'POST',
      headers: {
        Cookie: 'session=token-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        current: 'old password',
        next: 'new password',
      }),
    }),
  );

  return { db, oldHash, response, tokenHashA, tokenHashB };
}

test('正常改密保留当前会话并撤销其他会话', async () => {
  const { db, oldHash, response, tokenHashA } = await changePasswordRequest();

  expect(response.status).toBe(200);

  expect(
    (
      db.query("SELECT password_hash FROM users WHERE id = 'user-1'").get() as {
        password_hash: string;
      }
    ).password_hash,
  ).not.toBe(oldHash);

  const sessions = db
    .query('SELECT token_hash FROM sessions ORDER BY id')
    .all() as Array<{ token_hash: string }>;

  expect(sessions).toEqual([{ token_hash: tokenHashA }]);
});

test('验证后当前会话退出，改密仍撤销其他会话', async () => {
  const { db, oldHash, response } = await changePasswordRequest(
    (database, tokenHashA) => {
      database.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHashA]);
    },
  );

  expect(response.status).toBe(200);

  expect(
    (
      db.query("SELECT password_hash FROM users WHERE id = 'user-1'").get() as {
        password_hash: string;
      }
    ).password_hash,
  ).not.toBe(oldHash);

  expect(
    (
      db.query('SELECT count(*) AS count FROM sessions').get() as {
        count: number;
      }
    ).count,
  ).toBe(0);
});
