import { checkMailDomain, parseMailDomain } from './domains';
import {
  badRequest,
  isUniqueViolation,
  jsonError,
  methodNotAllowed,
  notFound,
  readJson,
} from './http';

const COOKIE_NAME = 'session';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 100_000;
// 登录失败次数与锁定时长（同 Roundcube 的 failed_login 计数）
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  language: string;
  role: 'owner' | 'user';
}

type PublicUser = Omit<AuthUser, 'id'>;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_NAME_LENGTH = 100;
// 邮箱地址 @ 前的部分：字母数字开头，可含 . _ + -
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/**
 * 用户名即邮箱地址 @ 前的部分，返回错误码或 null。
 */
export function validateUsername(value: string): string | null {
  if (!value || value.includes('@') || !USERNAME_PATTERN.test(value)) {
    return 'invalid username';
  }
  return null;
}

export function validateName(value: string): string | null {
  if (!value || value.length > MAX_NAME_LENGTH) {
    return 'name is empty';
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return 'password must be at least 8 characters';
  }

  if (value.length > MAX_PASSWORD_LENGTH) {
    return 'password is too long';
  }
  return null;
}

function toPublicUser(user: AuthUser): PublicUser {
  return {
    email: user.email,
    name: user.name,
    language: user.language,
    role: user.role,
  };
}

export async function handleAuth(
  env: Env,
  pathname: string,
  request: Request,
): Promise<Response> {
  switch (pathname) {
    case '/api/auth':
      return request.method === 'GET'
        ? authState(env, request)
        : methodNotAllowed();
    case '/api/auth/domain':
      return request.method === 'GET' ? setupDomain(env) : methodNotAllowed();
    case '/api/auth/setup':
      return request.method === 'POST'
        ? setup(env, request)
        : methodNotAllowed();
    case '/api/auth/login':
      return request.method === 'POST'
        ? login(env, request)
        : methodNotAllowed();
    case '/api/auth/logout':
      return request.method === 'POST'
        ? logout(env, request)
        : methodNotAllowed();
    case '/api/auth/password':
      return request.method === 'POST'
        ? changePassword(env, request)
        : methodNotAllowed();
    case '/api/auth/profile':
      return request.method === 'POST'
        ? updateProfile(env, request)
        : methodNotAllowed();
    default:
      return notFound();
  }
}

async function authState(env: Env, request: Request): Promise<Response> {
  if (!(await hasUsers(env))) {
    return Response.json({
      setupComplete: false,
      user: null,
      mailDomain: parseMailDomain(env.MAIL_DOMAIN),
    });
  }

  const user = await authenticate(request, env);

  return Response.json({
    setupComplete: true,
    user: user ? toPublicUser(user) : null,
    mailDomain: parseMailDomain(env.MAIL_DOMAIN),
  });
}

// 初始化向导：检查配置域名的就绪状态（仅未初始化时可访问）
async function setupDomain(env: Env): Promise<Response> {
  if (await hasUsers(env)) {
    return Response.json({ error: 'already initialized' }, { status: 409 });
  }

  return Response.json({ domain: await checkMailDomain(env.MAIL_DOMAIN) });
}

async function setup(env: Env, request: Request): Promise<Response> {
  if (await hasUsers(env)) {
    return Response.json({ error: 'already initialized' }, { status: 409 });
  }

  const payload = await readJson<{
    username?: unknown;
    name?: unknown;
    password?: unknown;
    language?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const domain = parseMailDomain(env.MAIL_DOMAIN);
  const username =
    typeof payload.username === 'string' ? payload.username.trim() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const language =
    typeof payload.language === 'string' && payload.language.trim()
      ? payload.language.trim()
      : 'zh-CN';

  if (!domain) {
    return badRequest('mail domain is not configured');
  }
  const usernameError = validateUsername(username);

  if (usernameError) {
    return badRequest(usernameError);
  }
  const nameError = validateName(name);

  if (nameError) {
    return badRequest(nameError);
  }
  const passwordError = validatePassword(password);

  if (passwordError) {
    return badRequest(passwordError);
  }

  const email = `${username}@${domain}`;
  const id = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, language)
       VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    )
      .bind(id, email, name, await hashPassword(password), language)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return jsonError('already initialized', 409);
    }
    throw error;
  }

  const token = await createSession(env, id);

  return Response.json(
    { user: { email, name, language, role: 'owner' as const } },
    { headers: { 'Set-Cookie': sessionCookie(token) } },
  );
}

async function login(env: Env, request: Request): Promise<Response> {
  const payload = await readJson<{
    username?: unknown;
    password?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const username =
    typeof payload.username === 'string' ? payload.username.trim() : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const domain = parseMailDomain(env.MAIL_DOMAIN);

  if (!domain || !username) {
    return Response.json({ error: 'invalid credentials' }, { status: 401 });
  }

  // 用户名是地址 @ 前的部分，域名固定；按完整地址等值查询才能用上 NOCASE 唯一索引
  const user = await env.DB.prepare(
    `SELECT id, email, name, language, role, status, password_hash,
            failed_login_at, failed_login_count
     FROM users WHERE email = ?`,
  )
    .bind(`${username}@${domain}`)
    .first<
      AuthUser & {
        password_hash: string | null;
        status: string;
        failed_login_at: string | null;
        failed_login_count: number;
      }
    >();

  if (user && lockedOut(user.failed_login_at, user.failed_login_count)) {
    return Response.json({ error: 'too many attempts' }, { status: 429 });
  }

  if (
    !user ||
    !user.password_hash ||
    !(await verifyPassword(password, user.password_hash))
  ) {
    if (user) {
      await recordFailedLogin(env, user.id, user);
    }
    return Response.json({ error: 'invalid credentials' }, { status: 401 });
  }

  if (user.status !== 'active') {
    return Response.json({ error: 'account disabled' }, { status: 403 });
  }

  if (user.failed_login_count > 0) {
    await env.DB.prepare(
      'UPDATE users SET failed_login_count = 0, failed_login_at = NULL WHERE id = ?',
    )
      .bind(user.id)
      .run();
  }

  const token = await createSession(env, user.id);

  return Response.json(
    { user: toPublicUser(user) },
    { headers: { 'Set-Cookie': sessionCookie(token) } },
  );
}

function lockedOut(at: string | null, count: number): boolean {
  return (
    count >= LOGIN_MAX_ATTEMPTS &&
    at !== null &&
    Date.now() - Date.parse(at) < LOGIN_LOCK_MS
  );
}

async function recordFailedLogin(
  env: Env,
  userId: string,
  user: { failed_login_at: string | null; failed_login_count: number },
): Promise<void> {
  // 距上次失败还在窗口内就累加，否则从 1 重新计
  const withinWindow =
    user.failed_login_at !== null &&
    Date.now() - Date.parse(user.failed_login_at) < LOGIN_LOCK_MS;
  const next = withinWindow ? user.failed_login_count + 1 : 1;

  await env.DB.prepare(
    'UPDATE users SET failed_login_count = ?, failed_login_at = ? WHERE id = ?',
  )
    .bind(next, new Date().toISOString(), userId)
    .run();
}

async function logout(env: Env, request: Request): Promise<Response> {
  const token = readSessionToken(request);

  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run();
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
      },
    },
  );
}

async function changePassword(env: Env, request: Request): Promise<Response> {
  const user = await authenticate(request, env);

  if (!user) {
    return jsonError('unauthorized', 401);
  }

  const payload = await readJson<{
    current?: unknown;
    next?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const current = typeof payload.current === 'string' ? payload.current : '';
  const next = typeof payload.next === 'string' ? payload.next : '';

  const passwordError = validatePassword(next);

  if (passwordError) {
    return badRequest(passwordError);
  }

  const record = await env.DB.prepare(
    'SELECT password_hash FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first<{ password_hash: string }>();

  if (!record || !(await verifyPassword(current, record.password_hash))) {
    return Response.json(
      { error: 'current password is incorrect' },
      { status: 401 },
    );
  }

  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(next), user.id)
    .run();

  // 改密后作废其它设备的会话，当前会话保留
  const token = readSessionToken(request);

  if (token) {
    await env.DB.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?',
    )
      .bind(user.id, await sha256Hex(token))
      .run();
  } else {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?')
      .bind(user.id)
      .run();
  }

  return Response.json({ ok: true });
}

// 更新账号资料：用户名、昵称与界面语言，只处理传入的字段
async function updateProfile(env: Env, request: Request): Promise<Response> {
  const user = await authenticate(request, env);

  if (!user) {
    return jsonError('unauthorized', 401);
  }

  const payload = await readJson<{
    username?: unknown;
    name?: unknown;
    language?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const username =
    typeof payload.username === 'string' ? payload.username.trim() : null;
  const name = typeof payload.name === 'string' ? payload.name.trim() : null;
  const language =
    typeof payload.language === 'string' ? payload.language.trim() : null;

  if (username === null && name === null && language === null) {
    return badRequest('nothing to update');
  }

  if (username !== null) {
    const error = validateUsername(username);

    if (error) {
      return Response.json({ error }, { status: 400 });
    }
  }

  if (name !== null) {
    const error = validateName(name);

    if (error) {
      return Response.json({ error }, { status: 400 });
    }
  }

  if (language !== null && (!language || language.length > 16)) {
    return badRequest('invalid language');
  }

  // 用户名即邮箱 @ 前的部分，只换用户名，域名沿用当前地址
  const domain = user.email.split('@')[1] ?? '';
  const email = username === null ? user.email : `${username}@${domain}`;

  if (email.toLowerCase() !== user.email.toLowerCase()) {
    const taken = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ? AND id <> ?',
    )
      .bind(email, user.id)
      .first();

    if (taken) {
      return Response.json({ error: 'username taken' }, { status: 409 });
    }
  }

  const nextName = name ?? user.name;
  const nextLanguage = language ?? user.language;

  try {
    await env.DB.prepare(
      'UPDATE users SET email = ?, name = ?, language = ? WHERE id = ?',
    )
      .bind(email, nextName, nextLanguage, user.id)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return jsonError('username taken', 409);
    }
    throw error;
  }

  return Response.json({
    user: { email, name: nextName, language: nextLanguage, role: user.role },
  });
}

export async function authenticate(
  request: Request,
  env: Env,
): Promise<AuthUser | null> {
  const token = readSessionToken(request);

  if (!token) {
    return null;
  }

  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.language, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<AuthUser>();

  return user ?? null;
}

async function hasUsers(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM users',
  ).first<{ count: number }>();

  return Boolean(row?.count);
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomHex(32);

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(
      crypto.randomUUID(),
      userId,
      await sha256Hex(token),
      new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    )
    .run();

  return token;
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function readSessionToken(request: Request): string | null {
  const header = request.headers.get('Cookie');

  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');

    if (name === COOKIE_NAME) {
      return rest.join('=');
    }
  }

  return null;
}

/**
 * 清理过期会话（定时任务调用）。
 */
export async function purgeExpiredSessions(env: Env): Promise<void> {
  // expires_at 存的是 ISO，用 datetime('now') 比较会因 'T' > ' ' 恒不成立
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?')
    .bind(new Date().toISOString())
    .run();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);

  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split('$');

  if (scheme !== 'pbkdf2-sha256' || !iterationsRaw || !saltRaw || !hashRaw) {
    return false;
  }

  const iterations = Number(iterationsRaw);

  if (!Number.isFinite(iterations)) {
    return false;
  }

  const hash = await pbkdf2(password, fromBase64(saltRaw), iterations);

  return timingSafeEqual(toBase64(hash), hashRaw);
}

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PASSWORD_ITERATIONS,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );

  return new Uint8Array(bits);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );

  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
