import {
  type AuthUser,
  createSession,
  hashPassword,
  randomHex,
  sessionCookie,
  sha256Hex,
  validateName,
  validatePassword,
  validateUsername,
} from './auth';
import { parseMailDomain } from './domains';
import {
  badRequest,
  isUniqueViolation,
  jsonError,
  methodNotAllowed,
  notFound,
  readJson,
} from './http';
import { purgeUserData } from './messages';

const USERS_PATH = '/api/users/';
const INVITE_PATH = '/api/invite/';
// 交给用户打开的前端路由，与接口前缀区分
const INVITE_LINK_PATH = '/invite/';
const LINK_SUFFIX = '/link';
const INVITE_TTL_SECONDS = 24 * 60 * 60;
const RESET_TTL_SECONDS = 60 * 60;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'user';
  status: 'invited' | 'active' | 'disabled';
  created_at: string;
}

interface TokenRow {
  purpose: 'invite' | 'reset';
  expires_at: string;
  user_id: string;
  email: string;
  name: string;
  status: 'invited' | 'active' | 'disabled';
}

/**
 * 用户管理：仅所有者可访问，负责列表、新建、启用停用与删除。
 */
export async function handleUsers(
  env: Env,
  pathname: string,
  request: Request,
  actor: AuthUser,
): Promise<Response> {
  if (actor.role !== 'owner') {
    return jsonError('forbidden', 403);
  }

  if (pathname === '/api/users') {
    if (request.method === 'GET') {
      return listUsers(env);
    }

    if (request.method === 'POST') {
      return createUser(env, request);
    }
    return methodNotAllowed();
  }

  if (!pathname.startsWith(USERS_PATH)) {
    return notFound();
  }

  const rest = pathname.slice(USERS_PATH.length);

  if (rest.endsWith(LINK_SUFFIX)) {
    return issueLink(env, rest.slice(0, -LINK_SUFFIX.length), request);
  }

  if (request.method === 'PATCH') {
    return updateUser(env, rest, request, actor);
  }

  if (request.method === 'DELETE') {
    return deleteUser(env, rest, actor);
  }
  return methodNotAllowed();
}

async function listUsers(env: Env): Promise<Response> {
  // 所有者固定置顶，其余按创建时间
  const { results } = await env.DB.prepare(
    `SELECT id, email, name, role, status, created_at
     FROM users
     ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at`,
  ).all<UserRow>();

  return Response.json(results);
}

async function createUser(env: Env, request: Request): Promise<Response> {
  const payload = await readJson<{
    username?: unknown;
    name?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const username =
    typeof payload.username === 'string' ? payload.username.trim() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const domain = parseMailDomain(env.MAIL_DOMAIN);

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

  const email = `${username}@${domain}`;
  const taken = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (taken) {
    return Response.json({ error: 'username taken' }, { status: 409 });
  }

  const id = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, role, status) VALUES (?, ?, ?, 'user', 'invited')`,
    )
      .bind(id, email, name)
      .run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      return jsonError('username taken', 409);
    }
    throw error;
  }

  const link = await issueToken(env, id, 'invite', new URL(request.url).origin);

  return Response.json({ id, link }, { status: 201 });
}

async function updateUser(
  env: Env,
  id: string,
  request: Request,
  actor: AuthUser,
): Promise<Response> {
  if (id === actor.id) {
    return badRequest('cannot modify yourself');
  }

  const payload = await readJson<{ status?: unknown }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const status = typeof payload.status === 'string' ? payload.status : '';

  if (status !== 'active' && status !== 'disabled') {
    return badRequest('invalid status');
  }

  const target = await env.DB.prepare(
    'SELECT id, status FROM users WHERE id = ?',
  )
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!target) {
    return notFound();
  }

  if (target.status === 'invited') {
    return badRequest('user has not activated');
  }

  await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?')
    .bind(status, id)
    .run();

  // 停用后立即作废其会话
  if (status === 'disabled') {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?')
      .bind(id)
      .run();
  }

  return Response.json({ ok: true });
}

async function deleteUser(
  env: Env,
  id: string,
  actor: AuthUser,
): Promise<Response> {
  if (id === actor.id) {
    return badRequest('cannot delete yourself');
  }

  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
    .bind(id)
    .first();

  if (!target) {
    return notFound();
  }

  await purgeUserData(env, id);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

  return Response.json({ ok: true });
}

async function issueLink(
  env: Env,
  id: string,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const target = await env.DB.prepare(
    'SELECT id, status FROM users WHERE id = ?',
  )
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!target) {
    return notFound();
  }

  if (target.status === 'disabled') {
    return badRequest('account disabled');
  }

  const purpose = target.status === 'invited' ? 'invite' : 'reset';
  const link = await issueToken(
    env,
    target.id,
    purpose,
    new URL(request.url).origin,
  );

  return Response.json({ link, purpose });
}

// 生成一次性链接，作废该用户此前未使用的链接
async function issueToken(
  env: Env,
  userId: string,
  purpose: 'invite' | 'reset',
  origin: string,
): Promise<string> {
  await env.DB.prepare('DELETE FROM user_tokens WHERE user_id = ?')
    .bind(userId)
    .run();

  const token = randomHex(32);
  const ttl = purpose === 'invite' ? INVITE_TTL_SECONDS : RESET_TTL_SECONDS;

  await env.DB.prepare(
    `INSERT INTO user_tokens (id, user_id, token_hash, purpose, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      await sha256Hex(token),
      purpose,
      new Date(Date.now() + ttl * 1000).toISOString(),
    )
    .run();

  return `${origin}${INVITE_LINK_PATH}${token}`;
}

/**
 * 一次性链接：未登录时凭链接设置密码，成功后自动登录。
 */
export async function handleInvite(
  env: Env,
  pathname: string,
  request: Request,
): Promise<Response> {
  const token = pathname.slice(INVITE_PATH.length);

  if (!token) {
    return notFound();
  }

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT t.purpose, t.expires_at, t.user_id, u.email, u.name, u.status
     FROM user_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();

  if (!row || row.expires_at <= new Date().toISOString()) {
    return jsonError('link is invalid or expired', 410);
  }

  // 停用的邮箱不能靠兑换链接重新启用，先启用再重置
  if (row.status === 'disabled') {
    return Response.json({ error: 'account disabled' }, { status: 403 });
  }

  if (request.method === 'GET') {
    return Response.json({
      email: row.email,
      name: row.name,
      purpose: row.purpose,
    });
  }

  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const payload = await readJson<{ password?: unknown }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const password = typeof payload.password === 'string' ? payload.password : '';
  const passwordError = validatePassword(password);

  if (passwordError) {
    return badRequest(passwordError);
  }

  // 条件删除当作闸门：并发兑换同一个 token 时只有一个能删到行
  const claimed = await env.DB.prepare(
    'DELETE FROM user_tokens WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .run();

  if (claimed.meta.changes !== 1) {
    return jsonError('link is invalid or expired', 410);
  }

  // 邀请链接负责激活，重置链接只换密码
  await env.DB.prepare(
    row.purpose === 'invite'
      ? `UPDATE users SET password_hash = ?, status = 'active' WHERE id = ?`
      : `UPDATE users SET password_hash = ? WHERE id = ?`,
  )
    .bind(await hashPassword(password), row.user_id)
    .run();

  // 设置新密码后作废该账号已有会话
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(row.user_id)
    .run();

  const sessionToken = await createSession(env, row.user_id);
  const user = await env.DB.prepare(
    'SELECT id, email, name, language, role FROM users WHERE id = ?',
  )
    .bind(row.user_id)
    .first<AuthUser>();

  return Response.json(
    {
      user: user
        ? {
            email: user.email,
            name: user.name,
            language: user.language,
            role: user.role,
          }
        : null,
    },
    { headers: { 'Set-Cookie': sessionCookie(sessionToken) } },
  );
}
