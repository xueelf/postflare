let onUnauthorized: (() => void) | null = null;
let authEpoch = 0;

/** 注册 401 处理（认证 Hook 挂载时设置） */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** 认证身份变化时推进代次，旧会话请求的 401 不能清理当前会话 */
export function advanceAuthEpoch(): void {
  authEpoch += 1;
}

/** 统一请求：只让当前认证代次的 401 通知认证层 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const requestEpoch = authEpoch;

  return fetch(input, init).then(res => {
    if (res.status === 401 && requestEpoch === authEpoch) {
      onUnauthorized?.();
    }
    return res;
  });
}
