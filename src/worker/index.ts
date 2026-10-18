import { getAttachment, uploadAttachment } from './attachments';
import {
  type AuthUser,
  authenticate,
  handleAuth,
  purgeExpiredSessions,
} from './auth';
import { composeMessage, discardDraft, saveDraft } from './compose';
import { jsonError, methodNotAllowed, notFound } from './http';
import { handleInbound } from './inbound';
import {
  emptyMailbox,
  getFolderCounts,
  getMessage,
  listMessages,
  markMessageRead,
  moveMessage,
  purgeExpired,
  purgeMessage,
} from './messages';
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from './templates';
import { handleInvite, handleUsers } from './users';

const USERS_PATH = '/api/users/';
const INVITE_PATH = '/api/invite/';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RouteContext {
  env: Env;
  request: Request;
  url: URL;
  params: Record<string, string>;
  user: AuthUser;
}

interface Route {
  method: HttpMethod;
  pattern: string;
  handler: (context: RouteContext) => Response | Promise<Response>;
}

/**
 * 取路径参数：模式里声明过的段一定存在，取不到说明路由表写错了。
 */
function param(params: Record<string, string>, name: string): string {
  const value = params[name];

  if (value === undefined) {
    throw new Error(`route pattern is missing :${name}`);
  }
  return value;
}

/**
 * 按段匹配路径模式，`:` 开头的段是参数；不匹配返回 null。
 */
function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const expected = pattern.split('/');
  const actual = pathname.split('/');

  if (expected.length !== actual.length) {
    return null;
  }
  const params: Record<string, string> = {};

  for (const [index, segment] of expected.entries()) {
    const value = actual[index] ?? '';

    if (segment.startsWith(':')) {
      if (!value) {
        return null;
      }
      params[segment.slice(1)] = decodeURIComponent(value);
    } else if (segment !== value) {
      return null;
    }
  }

  return params;
}

// 接口表：方法 + 路径模式 + 处理函数，方法不符由分发统一返回 405
const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: '/api/messages',
    handler: ({ env, url, user }) => listMessages(env, url, user.id),
  },
  {
    method: 'DELETE',
    pattern: '/api/messages',
    handler: ({ env, url, user }) => emptyMailbox(env, url, user.id),
  },
  {
    method: 'GET',
    pattern: '/api/messages/:id',
    handler: ({ env, params, user }) =>
      getMessage(env, param(params, 'id'), user.id),
  },
  {
    method: 'DELETE',
    pattern: '/api/messages/:id',
    handler: ({ env, params, user }) =>
      purgeMessage(env, param(params, 'id'), user.id),
  },
  {
    method: 'POST',
    pattern: '/api/messages/:id/read',
    handler: ({ env, params, user }) =>
      markMessageRead(env, param(params, 'id'), user.id),
  },
  {
    method: 'POST',
    pattern: '/api/messages/:id/mailbox',
    handler: ({ env, params, request, user }) =>
      moveMessage(env, param(params, 'id'), user.id, request),
  },
  {
    method: 'GET',
    pattern: '/api/counts',
    handler: ({ env, user }) => getFolderCounts(env, user.id),
  },
  {
    method: 'POST',
    pattern: '/api/compose',
    handler: ({ env, request, user }) => composeMessage(env, user, request),
  },
  {
    method: 'POST',
    pattern: '/api/drafts',
    handler: ({ env, request, user }) => saveDraft(env, user, request),
  },
  {
    method: 'DELETE',
    pattern: '/api/drafts/:id',
    handler: ({ env, params, user }) =>
      discardDraft(env, param(params, 'id'), user.id),
  },
  {
    method: 'POST',
    pattern: '/api/attachments',
    handler: ({ env, request, user }) =>
      uploadAttachment(env, request, user.id),
  },
  {
    method: 'GET',
    pattern: '/api/attachments/:id',
    handler: ({ env, params, user }) =>
      getAttachment(env, param(params, 'id'), user.id),
  },
  {
    method: 'GET',
    pattern: '/api/templates',
    handler: ({ env, user }) => listTemplates(env, user.id),
  },
  {
    method: 'POST',
    pattern: '/api/templates',
    handler: ({ env, request, user }) => createTemplate(env, request, user.id),
  },
  {
    method: 'PUT',
    pattern: '/api/templates/:id',
    handler: ({ env, params, request, user }) =>
      updateTemplate(env, param(params, 'id'), request, user.id),
  },
  {
    method: 'DELETE',
    pattern: '/api/templates/:id',
    handler: ({ env, params, user }) =>
      deleteTemplate(env, param(params, 'id'), user.id),
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
      return handleAuth(env, pathname, request);
    }

    // 注册/重置链接在未登录时使用
    if (pathname.startsWith(INVITE_PATH)) {
      return handleInvite(env, pathname, request);
    }

    const user = await authenticate(request, env);

    if (!user) {
      return jsonError('unauthorized', 401);
    }

    if (pathname === '/api/users' || pathname.startsWith(USERS_PATH)) {
      return handleUsers(env, pathname, request, user);
    }

    let pathMatched = false;

    for (const route of ROUTES) {
      const params = matchPath(route.pattern, pathname);

      if (!params) {
        continue;
      }
      pathMatched = true;

      if (route.method === request.method) {
        return route.handler({ env, request, url, params, user });
      }
    }

    return pathMatched ? methodNotAllowed() : notFound();
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleInbound(message, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(purgeExpired(env));
    ctx.waitUntil(purgeExpiredSessions(env));
  },
};
