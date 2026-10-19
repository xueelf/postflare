import { INVITE_MAX_TTL_SECONDS, INVITE_MAX_USES } from '#/invites';
import { DEFAULT_LOCALE, isLocale } from '#/locales';

import {
  type AuthUser,
  createSession,
  hashPassword,
  randomToken,
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
const RESET_TTL_SECONDS = 60 * 60;
// 链接令牌 8 位人类可读字符，约 46 位随机数。个人部署并发低，链接又有 24 小时有效期与人数上限，
// 在线爆破拿不到收益，用更短更好分享的码；低于 OWASP 对长期会话标识 64 位熵的建议是刻意的取舍
const TOKEN_LENGTH = 8;
// 客户端与服务端时钟可能有偏差，签发上限校验留出余量
const INVITE_EXPIRY_GRACE_SECONDS = 5 * 60;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'user';
  status: 'active' | 'disabled';
  created_at: string;
}

interface TokenRow {
  user_id: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string;
  email: string | null;
  name: string | null;
  status: 'active' | 'disabled' | null;
}

/**
 * 用户管理仅所有者可访问，负责列表、新建、启用停用与删除。
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
    return request.method === 'GET' ? listUsers(env) : methodNotAllowed();
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

/**
 * 邀请链接独立于用户，被邀请者自己选用户名与昵称。
 */
export async function createInvite(
  env: Env,
  request: Request,
  actor: AuthUser,
): Promise<Response> {
  if (actor.role !== 'owner') {
    return jsonError('forbidden', 403);
  }

  if (!parseMailDomain(env.MAIL_DOMAIN)) {
    return badRequest('mail domain is not configured');
  }

  const payload = await readJson<{ expiresAt?: unknown; maxUses?: unknown }>(
    request,
  );

  if (payload instanceof Response) {
    return payload;
  }

  const expiresAt =
    typeof payload.expiresAt === 'string' ? Date.parse(payload.expiresAt) : NaN;
  const maxUses = payload.maxUses;
  const expiryLimit =
    Date.now() + (INVITE_MAX_TTL_SECONDS + INVITE_EXPIRY_GRACE_SECONDS) * 1000;

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > expiryLimit
  ) {
    return badRequest('invalid invite expiry');
  }

  if (
    typeof maxUses !== 'number' ||
    !Number.isInteger(maxUses) ||
    maxUses < 1 ||
    maxUses > INVITE_MAX_USES
  ) {
    return badRequest('invalid invite uses');
  }

  const link = await issueToken(
    env,
    null,
    new Date(expiresAt),
    maxUses,
    new URL(request.url).origin,
  );

  return Response.json({ link }, { status: 201 });
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

  const link = await issueToken(
    env,
    target.id,
    new Date(Date.now() + RESET_TTL_SECONDS * 1000),
    1,
    new URL(request.url).origin,
  );

  return Response.json({ link });
}

// 生成一次性链接，作废该用户此前未使用的链接
async function issueToken(
  env: Env,
  userId: string | null,
  expiresAt: Date,
  maxUses: number,
  origin: string,
): Promise<string> {
  if (userId) {
    await env.DB.prepare('DELETE FROM user_tokens WHERE user_id = ?')
      .bind(userId)
      .run();
  }

  const token = randomToken(TOKEN_LENGTH);

  await env.DB.prepare(
    `INSERT INTO user_tokens (id, user_id, token_hash, max_uses, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      await sha256Hex(token),
      maxUses,
      expiresAt.toISOString(),
    )
    .run();

  return `${origin}${INVITE_LINK_PATH}${token}`;
}

/**
 * 一次性链接在未登录时使用，凭链接设置密码，成功后自动登录。
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
    `SELECT t.user_id, t.max_uses, t.used_count, t.expires_at, u.email, u.name, u.status
     FROM user_tokens t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<TokenRow>();

  if (
    !row ||
    row.expires_at <= new Date().toISOString() ||
    (row.user_id === null && row.used_count >= row.max_uses)
  ) {
    return jsonError('link is invalid or expired', 410);
  }

  // 停用的邮箱不能靠重置链接恢复
  if (row.status === 'disabled') {
    return Response.json({ error: 'account disabled' }, { status: 403 });
  }

  if (request.method === 'GET') {
    return Response.json(
      row.user_id === null
        ? { purpose: 'invite', domain: parseMailDomain(env.MAIL_DOMAIN) }
        : { purpose: 'reset', email: row.email, name: row.name },
    );
  }

  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  const payload = await readJson<{
    username?: unknown;
    name?: unknown;
    password?: unknown;
  }>(request);

  if (payload instanceof Response) {
    return payload;
  }
  const password = typeof payload.password === 'string' ? payload.password : '';
  const passwordError = validatePassword(password);

  if (passwordError) {
    return badRequest(passwordError);
  }

  return row.user_id === null
    ? activateInvite(env, tokenHash, payload, password)
    : resetPassword(env, row.user_id, tokenHash, password);
}

/**
 * 兑换邀请：建用户与消费令牌放在同一个批次里，用户名被占用时整批回滚，链接仍可重试。
 */
async function activateInvite(
  env: Env,
  tokenHash: string,
  payload: { username?: unknown; name?: unknown; language?: unknown },
  password: string,
): Promise<Response> {
  const domain = parseMailDomain(env.MAIL_DOMAIN);
  const username =
    typeof payload.username === 'string' ? payload.username.trim() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const requested =
    typeof payload.language === 'string' ? payload.language.trim() : '';
  const language = isLocale(requested) ? requested : DEFAULT_LOCALE;

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

  const id = crypto.randomUUID();
  const email = `${username}@${domain}`;
  const now = new Date().toISOString();

  try {
    const [created] = await env.DB.batch([
      // 名额未用尽才插入，避免并发兑换同一链接时多建账号
      env.DB.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, status, language)
         SELECT ?, ?, ?, ?, 'user', 'active', ?
         WHERE EXISTS (
           SELECT 1 FROM user_tokens
           WHERE token_hash = ? AND user_id IS NULL
             AND used_count < max_uses AND expires_at > ?
         )`,
      ).bind(
        id,
        email,
        name,
        await hashPassword(password),
        language,
        tokenHash,
        now,
      ),
      env.DB.prepare(
        `UPDATE user_tokens SET used_count = used_count + 1
         WHERE token_hash = ? AND user_id IS NULL
           AND used_count < max_uses AND expires_at > ?`,
      ).bind(tokenHash, now),
    ]);

    if (created?.meta.changes !== 1) {
      return jsonError('link is invalid or expired', 410);
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return jsonError('username taken', 409);
    }
    throw error;
  }

  return loginWithSession(env, id);
}

async function resetPassword(
  env: Env,
  userId: string,
  tokenHash: string,
  password: string,
): Promise<Response> {
  // 条件删除当作闸门，并发兑换同一个令牌时只有一个能删到行
  const claimed = await env.DB.prepare(
    'DELETE FROM user_tokens WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .run();

  if (claimed.meta.changes !== 1) {
    return jsonError('link is invalid or expired', 410);
  }

  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(password), userId)
    .run();

  // 设置新密码后作废该账号已有会话
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(userId)
    .run();

  return loginWithSession(env, userId);
}

// 签发会话并把用户资料返回给客户端
async function loginWithSession(env: Env, userId: string): Promise<Response> {
  const sessionToken = await createSession(env, userId);
  const user = await env.DB.prepare(
    'SELECT id, email, name, language, role FROM users WHERE id = ?',
  )
    .bind(userId)
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

/**
 * 清理过期的一次性链接，由定时任务调用。
 */
export async function purgeExpiredTokens(env: Env): Promise<void> {
  // expires_at 存的是 ISO，用 datetime('now') 比较会因 'T' > ' ' 恒不成立
  await env.DB.prepare('DELETE FROM user_tokens WHERE expires_at < ?')
    .bind(new Date().toISOString())
    .run();
}
