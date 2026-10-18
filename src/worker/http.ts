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

export function methodNotAllowed(): Response {
  return jsonError('method not allowed', 405);
}

/**
 * 解析 JSON 请求体，语法错误返回 400，不让畸形请求变成 500。
 */
export async function readJson<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
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
