/**
 * 接口层共用，统一错误响应与 JSON 解析。
 */
export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export function badRequest(error: string): Response {
  return jsonError(error, 400);
}

export function notFound(): Response {
  return jsonError('not found', 404);
}

export function methodNotAllowed(allowed: string[] = []): Response {
  return Response.json(
    { error: 'method not allowed' },
    {
      status: 405,
      headers: allowed.length > 0 ? { Allow: allowed.join(', ') } : {},
    },
  );
}

/**
 * 解析 JSON 请求体，语法错误返回 400，不让畸形请求变成 500。
 */
export async function readJson<T extends object>(
  request: Request,
): Promise<T | Response> {
  try {
    const value = await request.json();

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return badRequest('invalid json');
    }
    return value as T;
  } catch {
    return badRequest('invalid json');
  }
}

/**
 * D1 唯一约束冲突，并发下靠约束兜底，映射成 409 而不是 500。
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
  );
}
