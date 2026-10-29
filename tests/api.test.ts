import { afterEach, expect, test } from 'bun:test';

import {
  advanceAuthEpoch,
  apiFetch,
  setUnauthorizedHandler,
} from '#/client/api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setUnauthorizedHandler(null);
});

test('旧认证代次的 401 不清理当前会话', async () => {
  let resolveResponse!: (response: Response) => void;

  const response = new Promise<Response>(resolve => {
    resolveResponse = resolve;
  });

  globalThis.fetch = (() => response) as unknown as typeof fetch;

  let calls = 0;

  setUnauthorizedHandler(() => {
    calls += 1;
  });

  const request = apiFetch('/api/auth/profile');

  advanceAuthEpoch();
  resolveResponse(new Response(null, { status: 401 }));
  await request;

  expect(calls).toBe(0);
});

test('当前认证代次的 401 清理当前会话', async () => {
  globalThis.fetch = (async () =>
    new Response(null, { status: 401 })) as unknown as typeof fetch;

  let calls = 0;

  setUnauthorizedHandler(() => {
    calls += 1;
  });

  await apiFetch('/api/auth/profile');

  expect(calls).toBe(1);
});
