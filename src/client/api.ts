// 正文图片大小上限（与 Worker 侧校验保持一致）
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

let onUnauthorized: (() => void) | null = null;

/** 注册 401 处理（认证 Hook 挂载时设置） */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** 统一请求：401 时通知认证层清理会话 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then(res => {
    if (res.status === 401) {
      onUnauthorized?.();
    }
    return res;
  });
}
